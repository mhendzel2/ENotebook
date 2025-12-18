# Code Review: Electronic Lab Notebook (ELN)

## Overview
The codebase implements an Electronic Lab Notebook with an "Offline-first" architecture. It consists of a React/Electron client (`apps/client`) and an Express/Prisma server (`apps/server`).

## Architecture Analysis

### Strengths
1.  **Feature Rich Backend**: The server implements a wide range of ELN features including:
    *   Experiment & Method management with versioning.
    *   Inventory management (Reagents, Cell Lines, etc.) with CSV/Access import.
    *   21 CFR Part 11 style electronic signatures.
    *   Audit Logging.
    *   Role-Based Access Control (RBAC).
2.  **Sync Architecture**: The `EnhancedSyncService` in `apps/server` provides a robust foundation for offline-first capabilities, handling:
    *   Bidirectional sync (Push/Pull).
    *   Conflict resolution (Client-wins, Server-wins, Manual).
    *   Selective sync (by project, date, modality).
    *   Retries and offline queueing.
3.  **Data Modeling**: The Prisma schema (`schema.prisma`) is well-structured, using polymorphic relations for attachments/comments/signatures and JSON fields for flexible modality-specific data.
4.  **Shared Types**: `packages/shared` ensures type safety across client and server.

### Weaknesses / Gaps
1.  **Client-Server Coupling**: The "Offline-first" claim relies on the user running a local instance of the server. The Electron client (`apps/client`) appears to be a thin wrapper around a web view. It does not seemingly manage the lifecycle of the local server process, which might result in a poor UX (user has to start server manually).
2.  **Testing**: There is a severe lack of automated tests. The codebase contains complex logic (especially in `EnhancedSyncService` and `DataProcessingService`) that is currently untested.
3.  **Security**:
    *   Password hashing uses `pbkdf2Sync`. While secure, `bcrypt` or `argon2` are modern standards that offer better protection against GPU-accelerated cracking.
    *   API Key rate limiting is in-memory, which won't scale if the server is clustered (though fine for a local instance).
4.  **Code Organization**: `apps/server/src/index.ts` is overly large (~800 lines) and contains commented-out legacy code, making it hard to read and maintain.

## Recommendations

### 1. Refactoring & Cleanup
*   **Action**: Clean up `apps/server/src/index.ts`. Remove the large block of "LEGACY INLINE ROUTES" which are duplicated in the `routes/` directory.
*   **Benefit**: Improves maintainability and readability.

### 2. Security Improvements
*   **Action**: Replace `crypto.pbkdf2Sync` with `bcryptjs` for password hashing in `apps/server/src/routes/auth.ts`.
*   **Benefit**: Stronger security for user credentials.

### 3. Testing
*   **Action**: Introduce a testing framework (e.g., Vitest) and add unit tests for critical services like `EnhancedSyncService` and `Auth`.
*   **Benefit**: Prevents regressions and ensures reliability of sync logic.

### 4. Client-Side Orchestration
*   **Action**: Update `apps/client/src/main.ts` to spawn the local server process automatically when the application starts.
*   **Benefit**: True "install-and-run" offline-first experience.

## Planned Improvements (Immediate)
1.  Refactor `apps/server/src/index.ts` to remove dead code.
2.  Switch to `bcryptjs` for password hashing.
3.  Add basic unit tests for the Auth service.
