**Implementation Plan: Modular WebSocket UI for locallama MCP Server**

## **1. WebSocket Server Module (ws-server.ts)**

### **Location:**

- Create a new module: `src/modules/websocket-server/ws-server.ts`

### **Dependencies:**

- Install the required packages:
  ```sh
  npm install ws sqlite3 express
  npm install --save-dev @types/ws
  ```

### **Functionality:**

#### **Port Management:**

- Import the `net` module (built-in to Node.js).
- Implement the `findAvailablePort` function to dynamically find an available port, starting from 4000 (or `WS_PORT` environment variable).
- **Limit port range** between **4000-4100** to prevent infinite port searches.
- Store the selected port in `.locallama_port`.
- Expose an API at `http://localhost:3001/ws-port` to allow the UI to fetch the active WebSocket port.

#### **WebSocket Server Initialization:**

- Create a `WebSocketServer` instance using the `ws` library.
- Attach event listeners:
  - `connection`: Handle new WebSocket connections.
  - `message`: Handle incoming messages (specifically for job cancellation).
  - `error`: Handle WebSocket errors.
  - `close`: Handle WebSocket disconnections.

#### **Job Updates Broadcasting:**

- Create a `broadcastJobs` function that:
  - Retrieves active jobs from `jobTracker.getActiveJobs()`.
  - Retrieves all jobs from the SQLite database.
  - Combines and formats the job data (including `parent_task_id` for grouping).
  - Sends the formatted job data as a JSON string to all connected WebSocket clients.
- Call `broadcastJobs` whenever a job is created, updated, completed, canceled, or failed.

#### **Cancellation Handling:**

- Implement the `cancelJob` function:
  - If job is **queued**, remove it from the queue.
  - If job is **running**, send a **SIGTERM signal** for a graceful shutdown.
  - Update the job status in SQLite.
  - Call `broadcastJobs` to update the UI.

---

## **2. JobTracker Modifications (jobTracker.ts)**

### **Location:**

- `src/modules/decision-engine/services/jobTracker.ts`

### **Changes:**

- Import the `broadcastJobs` function from the WebSocket module.
- Modify the following methods to **call `broadcastJobs`**:
  - `createJob`, `updateJobProgress`, `completeJob`, `cancelJob`, `failJob`
- Add a **`parent_task_id`** property to the `Job` interface for grouping related tasks.
- **Persist active jobs in SQLite** across MCP restarts:
  - Implement `loadActiveJobsFromDb()` to reload active jobs into memory on startup.

---

## **3. SQLite Integration (db.ts)**

### **Location:**

- Create: `src/modules/websocket-server/db.ts`

### **Database Connection:**

- Store SQLite database in `./data/jobs.db` (configurable via `DB_PATH` env variable).
- Create a function `initDatabase` to:
  - Ensure `data` directory exists.
  - Open SQLite connection.
  - Create `jobs` table if it doesn’t exist.

### **Data Operations:**

- Implement functions for:
  - `insertJob` (insert new job into the database).
  - `updateJob` (update job status and progress).
  - `getAllJobsFromDb` (fetch job data for UI display).
  - `cleanupOldJobs` (delete jobs **older than 7 days** to control database size).

---

## **4. UI Implementation (ui.html)**

### **Location:**

- Create: `ui.html` in the project root.

### **HTML Structure:**

- Create a **job list container**.
- Implement a **job template** with placeholders for ID, description, status, tokens, complexity, priority, cost, and cancel button.

### **CSS (with Tailwind optional):**

- Define styling for jobs and job groups.
- **Collapsible sections** for grouped jobs.

### **JavaScript:**

#### **WebSocket Connection:**

- Fetch **WebSocket port** dynamically from `http://localhost:3001/ws-port`.
- Establish a **WebSocket connection** to `ws://localhost:[port]`.
- Attach event listeners:
  - `open`: Handle connection.
  - `message`: Update job list dynamically.
  - `error`: Handle errors.
  - `close`: Handle disconnects.

#### **UI Updates:**

- Implement `renderJobs()` function:
  - **Sort and group** jobs based on `parent_task_id`.
  - Create a **collapsible parent-child job structure**.
  - Append new jobs dynamically to the UI.

#### **Cancellation Handling:**

- Attach a **click event** to the cancel button.
- Send a `cancel_job` message (with `jobId`) to WebSocket server.

---

## **8. Next Steps - Incorporating `chat.ts` Into the WebSocket UI**

### **1️⃣ Integrate `chat.ts` Directly Into WebSocket Server**
- Move `chat.ts` to `src/modules/websocket-server/chatHandler.ts`.
- Modify it to accept WebSocket-based task submissions instead of `readline`.

### **2️⃣ Implement WebSocket-Controlled Task Execution**
- Expose a WebSocket route (`/submit-task`) for sending new tasks.
- Redirect received tasks to `chatHandler.ts`.
- Stream output/logs back to the UI via WebSockets.

### **3️⃣ Update UI to Allow Task Submission**
- Add a simple task submission form to `ui.html`.
- Send tasks to the WebSocket server using the `/submit-task` route.
- Display execution logs live in the UI.

