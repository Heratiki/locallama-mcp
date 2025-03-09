#!/usr/bin/env python3
"""
retriv_bridge.py

This script serves as a bridge between the TypeScript/Node.js application and the retriv Python library.
It reads JSON commands from stdin and writes JSON results to stdout.
"""

import json
import sys
import os
import time
import traceback
# Update the import based on retriv's actual package structure
from retriv.sparse_retriever.sparse_retriever import SparseRetriever

# Global variables
sparse_retriever = None
indexed = False

def log_message(message, level="INFO"):
    """
    Log a message with timestamp and level
    """
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    log_line = {
        "timestamp": timestamp,
        "level": level,
        "message": message
    }
    # Print to stderr to avoid interfering with JSON communication
    print(json.dumps(log_line), file=sys.stderr)

def process_index_command(command_data):
    """
    Index documents using retriv SparseRetriever with BM25
    """
    global sparse_retriever, indexed
    
    directories = command_data.get("directories", [])
    options = command_data.get("options", {})
    
    log_message(f"Starting indexing for directories: {directories}")
    
    # Extract BM25 parameters
    k1 = options.get("k1", 1.5)
    b = options.get("b", 0.75)
    epsilon = options.get("epsilon", 0.25)
    
    log_message(f"Using BM25 parameters: k1={k1}, b={b}, epsilon={epsilon}")
    
    # Create and configure the SparseRetriever instance with proper hyperparameters
    hyperparams = {
        "k1": k1,
        "b": b,
        "epsilon": epsilon
    }
    
    try:
        sparse_retriever = SparseRetriever(
            model="bm25",  # Use BM25 retrieval model
            hyperparams=hyperparams  # Pass hyperparams as a dictionary
        )
        log_message("SparseRetriever initialized successfully")
        
        # Process all files in the directories
        all_documents = []
        file_paths = []
        
        for directory in directories:
            if not os.path.exists(directory):
                log_message(f"Directory not found: {directory}", "ERROR")
                continue
                
            log_message(f"Scanning directory: {directory}")
            for root, _, files in os.walk(directory):
                for file in files:
                    if file.endswith(('.md', '.txt', '.py', '.js', '.ts', '.html', '.css', '.json')):
                        file_path = os.path.join(root, file)
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                content = f.read()
                                all_documents.append(content)
                                file_paths.append(file_path)
                                log_message(f"Added file: {file_path}")
                        except Exception as e:
                            log_message(f"Error reading file {file_path}: {str(e)}", "ERROR")
        
        total_files = len(all_documents)
        log_message(f"Found {total_files} files to index")
        
        if all_documents:
            log_message(f"Indexing {total_files} documents...")
            start_time = time.time()
            sparse_retriever.index(all_documents)
            end_time = time.time()
            
            indexed = True
            log_message(f"Indexing completed in {end_time - start_time:.2f} seconds")
            
            response = {
                "status": "success",
                "total_files": total_files,
                "time_taken": f"{end_time - start_time:.2f} seconds",
                "file_paths": file_paths
            }
            print(json.dumps(response))
        else:
            log_message("No documents found to index", "WARNING")
            print(json.dumps({
                "status": "warning",
                "message": "No documents found to index"
            }))
    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        log_message(f"Error during indexing: {error_msg}", "ERROR")
        log_message(f"Stack trace: {stack_trace}", "ERROR")
        print(json.dumps({
            "status": "error",
            "message": error_msg,
            "stack_trace": stack_trace
        }))

def process_search_command(command_data):
    """
    Search indexed documents using the query
    """
    global sparse_retriever, indexed
    
    if not indexed or sparse_retriever is None:
        log_message("No documents have been indexed yet", "ERROR")
        print(json.dumps({
            "action": "search_results",
            "results": [],
            "error": "No documents have been indexed yet"
        }))
        return
    
    query = command_data.get("query", "")
    top_k = command_data.get("topK", 5)
    
    log_message(f"Searching for: '{query}' (top_k={top_k})")
    
    if not query:
        log_message("Empty query provided", "WARNING")
        print(json.dumps({
            "action": "search_results",
            "results": [],
            "error": "Empty query provided"
        }))
        return
    
    # Perform the search
    try:
        start_time = time.time()
        results = sparse_retriever.search(query, k=top_k)
        end_time = time.time()
        
        log_message(f"Search completed in {end_time - start_time:.4f} seconds. Found {len(results)} results.")
        
        # Format results for TypeScript
        formatted_results = []
        for i, (doc_id, score) in enumerate(results):
            formatted_results.append({
                "index": int(doc_id),  # The index in the original document list
                "score": float(score)  # The similarity score
            })
            log_message(f"Result {i+1}: Document #{doc_id} with score {score:.4f}")
        
        print(json.dumps({
            "action": "search_results",
            "results": formatted_results,
            "time_taken": f"{end_time - start_time:.4f} seconds"
        }))
    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        log_message(f"Error during search: {error_msg}", "ERROR")
        log_message(f"Stack trace: {stack_trace}", "ERROR")
        print(json.dumps({
            "action": "search_results",
            "results": [],
            "error": error_msg,
            "stack_trace": stack_trace
        }))

def main():
    """
    Main function to process commands
    """
    log_message("Retriv bridge starting up...")
    
    # Signal that the bridge is ready
    print("RETRIV_READY")
    sys.stdout.flush()
    log_message("Retriv bridge ready for commands")
    
    # Process commands
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        
        try:
            command = json.loads(line)
            action = command.get("action", "")
            
            log_message(f"Received command: {action}")
            
            if action == "index":
                process_index_command(command)
            elif action == "search":
                process_search_command(command)
            else:
                log_message(f"Unknown action: {action}", "ERROR")
                print(json.dumps({"error": f"Unknown action: {action}"}))
            
            sys.stdout.flush()
        except json.JSONDecodeError:
            log_message("Invalid JSON command", "ERROR")
            print(json.dumps({"error": "Invalid JSON command"}))
            sys.stdout.flush()
        except Exception as e:
            error_msg = str(e)
            stack_trace = traceback.format_exc()
            log_message(f"Unexpected error: {error_msg}", "ERROR")
            log_message(f"Stack trace: {stack_trace}", "ERROR")
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()