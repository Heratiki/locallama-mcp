# 📘 LocalLlama-MCP Server - Tool & Resource Documentation

## **Overview**
The `LocalLlama-MCP` server provides a structured way for **Cline/Roo Code/Claude Desktop** to interact with **decision-making models, retrieve existing code, and manage coding tasks efficiently**. It integrates **Retriv** for intelligent code searching and **a custom TypeScript-based decision engine** inspired by [HazyResearch/minions](https://github.com/HazyResearch/minions).

### **🔹 Key Features:**
- **Smart Task Routing** → Prioritizes existing code, then routes tasks to local/free/paid LLMs.
- **Full Job Tracking** → Active jobs, progress updates, and task history.
- **Real-time Indexing Feedback** → ETAs and progress bars for Retriv.
- **Token & Cost Management** → Estimates costs before execution, tracks usage.

---

## **📌 Tools (setupToolHandlers.ts)**
These tools allow `Cline/Roo Code/Claude Desktop` to **execute coding tasks, retrieve information, and monitor execution progress**.

### **1️⃣ route_task**  
🚀 **Routes a coding task to a decision engine, manages execution, and returns results**.

**🔄 Steps:**
1. **Retriv searches for relevant code** in existing repositories.
2. **Decision engine assigns the task** (Local → Free API → Paid API).
3. **A new job is created** in `locallama://jobs/active`.
4. **Progress is tracked** via `locallama://jobs/progress/{jobId}`.
5. **Returns DIFF or new file** and stores in Retriv.

**📥 Input Schema:**
```json
{
  "task": "Refactor authentication module",
  "files_affected": ["auth.js"],
  "context_length": 4000,
  "expected_output_length": 500,
  "complexity": 0.7,
  "priority": "cost",
  "preemptive": false
}
```

**📤 Output Example:**
```json
{
  "job_id": "job_abc123",
  "status": "Queued",
  "eta": "3 minutes"
}
```

---

### **2️⃣ get_cost_estimate**  
💰 **Estimates token and dollar cost before execution**.

**📥 Input Schema:**
```json
{
  "context_length": 4000,
  "expected_output_length": 500,
  "complexity": 0.7
}
```

**📤 Output Example:**
```json
{
  "local_model": "$0 (Free)",
  "openrouter_free": "$0 (Limited)",
  "openrouter_paid": "$0.10"
}
```

---

### **3️⃣ get_active_jobs**  
🖥️ **Lists currently running jobs, including progress tracking.**

**📤 Output Example:**
```json
{
  "jobs": [
    {
      "id": "job_abc123",
      "task": "Refactor authentication module",
      "status": "In Progress",
      "progress": "65%",
      "estimated_time_remaining": "4 minutes"
    },
    {
      "id": "job_def456",
      "task": "Implement caching layer",
      "status": "Queued",
      "progress": "Pending",
      "estimated_time_remaining": "N/A"
    }
  ]
}
```

---

### **4️⃣ get_job_progress/{jobId}**  
📊 **Fetches progress of a specific job.**

**📤 Output Example:**
```json
{
  "jobId": "job_abc123",
  "status": "In Progress",
  "progress": "65%",
  "estimated_time_remaining": "4 minutes"
}
```

---

### **5️⃣ cancel_job/{jobId}**  
⏹ **Cancels a running job.**

**📤 Output Example:**
```json
{
  "jobId": "job_abc123",
  "status": "Cancelled"
}
```

---

### **6️⃣ get_free_models**  
🆓 **Fetches free models, ranked by performance.**

**📤 Output Example:**
```json
{
  "models": [
    { "name": "Mistral-7B", "accuracy": "85%", "speed": "Fast" },
    { "name": "Llama-2-13B", "accuracy": "80%", "speed": "Medium" }
  ]
}
```

---

### **7️⃣ benchmark_task**  
📈 **Benchmarks a task across different models.**

**📤 Output Example:**
```json
{
  "local": { "speed": "2 sec", "cost": "$0", "accuracy": "85%" },
  "openrouter_free": { "speed": "5 sec", "cost": "$0", "accuracy": "82%" },
  "openrouter_paid": { "speed": "1 sec", "cost": "$0.10", "accuracy": "90%" }
}
```

---

## **🔹 Resources (setupResourceHandlers.ts)**

### **1️⃣ locallama://jobs/active**  
🔎 **Lists all active jobs.**

---

### **2️⃣ locallama://jobs/progress/{jobId}**  
📊 **Real-time progress tracking for jobs.**

---

### **3️⃣ locallama://jobs/history**  
📜 **Lists completed jobs and results.**

---

### **4️⃣ locallama://retriv/index-status**  
⏳ **Displays current indexing progress.**

**📤 Output Example:**
```json
{
  "progress": "40%",
  "estimated_time_remaining": "5 minutes"
}
```

---

### **5️⃣ locallama://minions/jobs**  
🤖 **Shows pending & running jobs in the decision engine.**

---

## **🛠️ Next Steps**
✅ Implement missing API endpoints for `cancel_job` and progress tracking.
✅ Ensure Retriv provides real-time indexing updates.
✅ Test cost estimation accuracy before execution.
✅ Optimize task queue handling and ensure Claude provides user-friendly VS Code feedback.

---

## **🔍 Summary**
This documentation ensures `LocalLlama-MCP` **fully supports intelligent task routing, cost tracking, and real-time job progress monitoring**. Claude (via Roo Code/Cline.Bot/Claude Desktop) will be able to **query, execute, and monitor tasks efficiently** while keeping the user informed in VS Code.

