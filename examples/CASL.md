**CASL** (Code Access Security Language) is an isomorphic authorization library that allows you to define permissions in a single, clean rule builder. You can share this exact rules file between your Node.js backend (to secure API endpoints) and your React frontend (to control UI rendering).

Here is how to implement CASL in a production React application.

---

### Step 1: Install Dependencies

```bash
npm install @casl/ability @casl/react

```

### Step 2: Create the Shared Ability Builder (Isomorphic)

This function can be imported by both your Express/NestJS backend and your React app. It builds an `AppAbility` instance based on the user's attributes.

```typescript
// src/auth/defineAbility.ts
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability';

export type Actions = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type Subjects = 'Document' | 'User' | 'all';

export type AppAbility = MongoAbility<[Actions, Subjects]>;

export function defineAbilityFor(user: { id: string; role: string; departmentId: string }) {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (user.role === 'admin') {
    // Admins can do everything
    can('manage', 'all');
  } else {
    // Standard user permissions & ABAC rules
    can('read', 'Document', { departmentId: user.departmentId });
    
    // Can update only documents they authored
    can('update', 'Document', { authorId: user.id });

    // Cannot delete documents that are already published
    cannot('delete', 'Document', { status: 'published' });
  }

  return build();
}

```

### Step 3: Set up the React Context & Provider

Integrate the CASL ability instance into your existing `AuthProvider`.

```tsx
// src/auth/AbilityProvider.tsx
import React, { createContext, useContext, useMemo } from 'react';
import { createContextCan } from '@casl/react';
import { AppAbility, defineAbilityFor } from './defineAbility';
import { useAuth } from './useAuth';

// 1. Create the React context for CASL
export const AbilityContext = createContext<AppAbility>(null!);

// 2. Export the pre-built declarative <Can> component bound to our context
export const Can = createContextCan(AbilityContext);

export function AbilityProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();

  // Generate abilities whenever the user object changes
  const ability = useMemo(() => {
    if (state.status === 'authenticated') {
      return defineAbilityFor(state.user);
    }
    // Return an empty ability object if unauthenticated
    return defineAbilityFor({ id: '', role: 'guest', departmentId: '' });
  }, [state]);

  return (
    <AbilityContext.Provider value={ability}>
      {children}
    </AbilityContext.Provider>
  );
}

```

### Step 4: UI Integration with `<Can>` and `useAbility`

CASL provides a built-in `<Can>` component and a `useAbility` hook that handle object-level attribute checks automatically.

```tsx
// src/components/DocumentCard.tsx
import React from 'react';
import { useAbility } from '@casl/react';
import { AbilityContext, Can } from '../auth/AbilityProvider';

export function DocumentCard({ document }) {
  // Option A: Using the hook for conditional logic inside JS
  const ability = useAbility(AbilityContext);
  const canPublish = ability.can('update', document);

  return (
    <div className="card">
      <h3>{document.title}</h3>
      <p>Status: {document.status}</p>

      {/* Option B: Using the declarative <Can> component */}
      <Can I="update" an={document}>
        <button className="btn-primary">Edit Document</button>
      </Can>

      <Can I="delete" an={document}>
        <button className="btn-danger">Delete Document</button>
      </Can>

      {canPublish && <span className="badge">You have edit rights</span>}
    </div>
  );
}

```

---

### Caveats & Tradeoffs

| Feature | Production Implication |
| --- | --- |
| **Object-Level Evaluation** | CASL evaluates rules against raw JavaScript objects (`document`). If your frontend only holds partial fields (e.g., missing `authorId`), the evaluation will silently fail. Ensure your API responses match the exact schema shape your CASL rules expect. |
| **Bundle Size** | `@casl/ability` is lightweight, but wrapping complex MongoDB-style query parsing logic adds a small amount of weight to your client-side bundle. |
| **Backend Mirroring** | To gain the true benefit of CASL, your Node.js backend must use the exact same `defineAbilityFor(user)` function inside its API middleware to reject unauthorized requests before querying the database. |