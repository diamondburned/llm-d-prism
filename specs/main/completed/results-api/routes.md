# Prism Cloud API Route Reference

This document catalogs all endpoints exposed by the Prism API backend.

---

## 1. Authentication & Session Endpoints

Prism utilizes GitHub OAuth for user authentication and role resolution. For a
detailed overview of the authorization architecture, token storage, and GCS user
allowlists, please refer to the dedicated
[Identity & Access Management (IAM) spec](iam.md).

### `GET /api/auth/github/login`

Redirects the client browser to the GitHub OAuth authorize endpoint to begin
authentication.

### `GET /api/auth/github/callback`

Handles redirect callback from GitHub OAuth, exchanges the temporary
authorization code for a GitHub access token (and optional refresh token), and
redirects back to the frontend with the tokens stored in the URL hash fragment
(`#access_token=<token>&refresh_token=<token>&expires_in=<seconds>&state=<state>`).

### `GET /api/auth/github/me`

Resolves the current session state.

- **Headers:** `X-Prism-Github-Token: <access_token>` (optional)
- **Response (200 OK):**
    - **Authenticated:**
        ```json
        {
          "authenticated": true,
          "configured": true,
          "username": "<username>",
          "permission": "admin" | "user" | "none",
          "avatarUrl": "<avatar_url>"
        }
        ```
    - **Unauthenticated:**
        ```json
        {
            "authenticated": false,
            "configured": true,
            "username": null,
            "permission": "none"
        }
        ```

### `POST /api/auth/github/refresh`

Exchanges a valid refresh token for a new set of GitHub access and refresh
tokens.

- **Request Body:** `{ "refresh_token": "<token>" }`
- **Response (200 OK):**
  `{ "access_token": "<token>", "expires_in": <seconds>, "refresh_token": "<token>", "refresh_token_expires_in": <seconds> }`

### `POST /api/auth/github/logout`

Performs client session cleanup (always returns successful).

---

## 2. Benchmark Results API

These endpoints facilitate listing and inspecting staged or submitted benchmark
run bundles. Detailed parameters, response formats, and authorization policies
are documented inline inside the implementation handler files.

### `GET /api/results`

Lists benchmark runs from the active Prism results store (defined in
`RESULTS_STORE_BUCKET`).

- **Headers:** `X-Prism-Github-Token: <access_token>` (optional)
- **Query Parameters:**
    - `limit`: (Optional) Maximum number of results to return (integer, defaults
      to 10, max 100).
    - `pageToken`: (Optional) Pagination token retrieved from the
      `nextPageToken` of a prior list response.
    - `status`: (Optional) Filter by submission status (`staged` |
      `submitted_pending_processing` | `unlisted` | `submitted_pending_review` |
      `public` | `promoted` | `rejected`).
    - `own`: (Optional) Filter to retrieve only the logged-in user's submissions
      (`true` | `false`).
- **Authorization & Default Visibility Rules:**
    - **Admin:** Can list benchmarks in all statuses (including all
      `submitted_pending_review` items in the review queue).
    - **Standard User/Guest:**
        - Can list their own benchmarks in any status (including `unlisted` and
          their own `submitted_pending_review` runs).
        - Can list `public` or `promoted` benchmarks.
        - Can list `unlisted` benchmarks when explicitly querying
          `status=unlisted` (unlisted is not secret, but hidden by default from
          general search calls).
        - `submitted_pending_review` benchmarks belonging to _other_ users are
          restricted to Admins only and are filtered out.

### `POST /api/results`

Submits a benchmark result bundle to the active results store.

- **Headers:** `X-Prism-Github-Token: <access_token>` (required)
- **Query Parameters / Body Field:**
    - `targetState`: (Optional) `"unlisted"` | `"submitted_pending_review"`
      (defaults to `"submitted_pending_review"`).
        - `"unlisted"`: Benchmarks skip human review and transition straight
          from automated processing to `unlisted`. Useful for preliminary or
          unverified data playgrounds.
        - `"submitted_pending_review"`: Benchmarks pass automated processing and
          are queued for Admin human review.
- **Request Body:** A JSON object representing the benchmark run upload payload
  matching the `PrismResultPayload` schema.
- **Authorization Rules:** Only allowlisted contributors (with role `user` or
  `admin`) can submit benchmark results.
- **Server-Side ID Mutation:** All internal IDs (including top-level `runId` and
  nested entry `run_id`s) are regenerated on the server to prevent ID
  collisions.
- **Validation Failures:** If automated validation fails during processing, the
  endpoint returns `400 Bad Request`.
- **Response (201 Created):**
    ```json
    {
        "success": true,
        "runId": "<server_generated_run_id>",
        "oldRunId": "<client_supplied_run_id>",
        "state": "unlisted" | "submitted_pending_review",
        "message": "Benchmark result successfully processed and saved."
    }
    ```

### `GET /api/results/:runId`

Retrieves the complete payload of a single benchmark submission run bundle by
its UUID.

- **Headers:** `X-Prism-Github-Token: <access_token>` (optional)
- **Path Validation:** `runId` must be a valid UUID regex format.
- **Authorization Rules:**
    - **Admin:** Full access to view any benchmark bundle.
    - **Standard User/Guest:**
        - Can view their own benchmark run bundle in any state.
        - Can view other contributors' bundles if state is `public`, `promoted`,
          OR `unlisted` (unlisted runs are accessible via direct link/UUID
          lookup).
        - Returns `403 Forbidden` (or `404 Not Found`) for
          `submitted_pending_processing`, `submitted_pending_review`, or
          `rejected` items belonging to other users.

### `POST /api/results/:runId/status`

Updates the review status and/or registers admin feedback for a benchmark result
submission.

- **Headers:** `X-Prism-Github-Token: <access_token>` (required)
- **Request Body:**
    ```json
    {
        "status": "<submission_state>",
        "feedback": "<optional_reason_string>",
        "reviewer": "<optional_username>"
    }
    ```
- **Authorization & State Machine Rules:**
    - **Admin:** Can approve (`public` / `promoted`), reject (`rejected`), or
      reset review queue state. Optional `feedback` and `reviewer` fields are
      recorded in the review history. Admins do not manage or promote unlisted
      benchmarks.
    - **Submitting User (Owner):** Can promote their own benchmark from
      `unlisted` $\rightarrow$ `submitted_pending_review` via a single-click
      action ("Promote to Review").
        - **Field Restrictions:** When promoting from `unlisted` $\rightarrow$
          `submitted_pending_review`, `feedback` and `reviewer` fields are
          **unused and forbidden**. Sending `feedback` or `reviewer` in the
          request body returns `400 Bad Request`.
        - Any attempt by non-admins to set state to `public` or `rejected`
          returns `403 Forbidden`.
    - **Other users:** `403 Forbidden`.

### `DELETE /api/results/:runId`

Permanently deletes an unlisted or rejected benchmark result bundle from the GCS
Results Store.

- **Headers:** `X-Prism-Github-Token: <access_token>` (required)
- **Path Validation:** `runId` must be a valid UUID regex format or it returns
  `400 Bad Request`.
- **Authorization Rules:**
    - **Submitting User (Owner):** Can permanently delete their own benchmark if
      its current state is `unlisted`. Attempts to delete items in non-unlisted
      states return `403 Forbidden`.
    - **Admin:** Can permanently delete any benchmark whose state is `unlisted`
      or `rejected`. Any attempt to delete benchmarks in active public or review
      states (`staged`, `submitted_pending_processing`,
      `submitted_pending_review`, `public`, `promoted`) returns `403 Forbidden`.
    - **Other users:** `403 Forbidden`.
- **Response (200 OK):**
    ```json
    {
        "success": true,
        "message": "Benchmark <runId> successfully deleted."
    }
    ```

---

## 3. General Proxy & Configuration Endpoints

### `GET /api/config`

Retrieves shared environment parameters.

### `ALL /api/giq/*`

Proxies requests to the Google Kubernetes Engine Recommender API (GIQ) at
`gkerecommender.googleapis.com`.

- **Authentication:** Injects the server's Application Default Credentials (ADC)
  token as the `Authorization: Bearer <token>` header if a valid bearer token is
  not provided by the client.
- **Headers:** `X-Goog-User-Project` (Optional, defaults to backend server
  project ID).

### `GET /api/regressions`

Retrieves a parsed list of regression reports from the public benchmark results
store.

- **Query Parameters:**
    - `refresh`: (Optional) Set to `true` to bypass the server's 5-minute memory
      cache and force GCS fetch.
- **Caching:** Responses are cached on the server for 5 minutes.

### `ALL /api/gcs/*`

Proxies requests to Google Cloud Storage for private buckets. Authenticates
using the server's Application Default Credentials (ADC).

---

## 4. Local Development Staging Endpoints

### `GET /api/local/list`

Lists locally staged benchmarks (Development Mode only).

### `GET /api/local/file/*`

Serves a local staged benchmark file from the private/benchmarks folder.
