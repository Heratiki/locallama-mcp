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

# Global variables
sparse_retriever = None
indexed = False
indexed_docs = []
indexed_files = []

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
    global sparse_retriever, indexed, indexed_docs, indexed_files
    
    directories = command_data.get("directories", [])
    documents = command_data.get("documents", [])
    options = command_data.get("options", {})
    
    if directories:
        log_message(f"Starting indexing for directories: {directories}")
    else:
        log_message(f"Starting indexing for {len(documents)} direct documents")
    
    # Extract BM25 parameters
    k1 = options.get("k1", 1.5)
    b = options.get("b", 0.75)
    epsilon = options.get("epsilon", 0.25)
    
    log_message(f"Using BM25 parameters: k1={k1}, b={b}, epsilon={epsilon}")
    
    try:
        # Create a new clean instance of the retriv library components directly
        try:
            # Try importing directly
            from retriv.sparse.bm25 import BM25
            log_message("Imported retriv.sparse.bm25.BM25 directly")
            use_direct_import = True
        except ImportError:
            # Fall back to the sparse_retriever approach
            from retriv.sparse_retriever.sparse_retriever import SparseRetriever
            log_message("Imported retriv.sparse_retriever.sparse_retriever.SparseRetriever")
            use_direct_import = False
        
        # Configure hyperparameters
        hyperparams = {
            "k1": k1,
            "b": b,
            "epsilon": epsilon
        }
        
        if use_direct_import:
            # Use direct BM25 instance
            sparse_retriever = BM25(**hyperparams)
            log_message("Created BM25 instance directly")
        else:
            # Use SparseRetriever with BM25 model
            sparse_retriever = SparseRetriever(
                model="bm25",
                hyperparams=hyperparams
            )
            log_message("Created SparseRetriever with BM25 model")
        
        log_message("Retriever initialized successfully")
        
        # Collect documents
        text_documents = []
        file_paths = []
        
        # Process directories if provided
        if directories:
            total_files_found = 0
            files_with_content = 0
            
            for directory in directories:
                if not os.path.exists(directory):
                    log_message(f"Directory not found: {directory}", "ERROR")
                    continue
                    
                log_message(f"Scanning directory: {directory}")
                dir_files_count = 0
                
                for root, _, files in os.walk(directory):
                    for file in files:
                        if file.endswith(('.md', '.txt', '.py', '.js', '.ts', '.html', '.css', '.json')):
                            file_path = os.path.join(root, file)
                            total_files_found += 1
                            
                            try:
                                with open(file_path, 'r', encoding='utf-8') as f:
                                    content = f.read().strip()
                                    
                                    if content:  # Ensure content is not empty
                                        dir_files_count += 1
                                        files_with_content += 1
                                        text_documents.append(content)
                                        file_paths.append(file_path)
                                        log_message(f"Added file {dir_files_count}: {file_path} ({len(content)} bytes)")
                                    else:
                                        log_message(f"Skipping empty file: {file_path}", "WARNING")
                            except Exception as e:
                                log_message(f"Error reading file {file_path}: {str(e)}", "ERROR")
                
                log_message(f"Found {dir_files_count} non-empty files in directory {directory}")
            
            log_message(f"Total files scanned: {total_files_found}, Files with content: {files_with_content}")
        
        # Process direct documents if provided
        elif documents:
            for i, doc in enumerate(documents):
                if doc.strip():  # Ensure document is not empty
                    text_documents.append(doc)
                    file_paths.append(f"document_{i}")
                    log_message(f"Added document #{i} ({len(doc)} bytes)")
                else:
                    log_message(f"Skipping empty document #{i}", "WARNING")
        
        # Store for later use in search
        indexed_docs = text_documents
        indexed_files = file_paths
        
        total_docs = len(text_documents)
        log_message(f"Collected {total_docs} total documents for indexing")
        
        if text_documents:
            log_message(f"Starting indexing of {total_docs} documents...")
            start_time = time.time()
            
            try:
                # Index the documents
                if use_direct_import:
                    sparse_retriever.index(text_documents)
                    log_message("Documents indexed using direct BM25")
                else:
                    sparse_retriever.index(text_documents)
                    log_message("Documents indexed using SparseRetriever")
                
                indexed = True
                end_time = time.time()
                duration = end_time - start_time
                
                # Check indexed documents count
                doc_count = 0
                try:
                    if hasattr(sparse_retriever, 'get_doc_ids'):
                        doc_ids = sparse_retriever.get_doc_ids()
                        doc_count = len(doc_ids)
                    else:
                        # If get_doc_ids not available, assume all docs were indexed
                        doc_count = total_docs
                except Exception as e:
                    log_message(f"Could not get document count: {str(e)}", "WARNING")
                    doc_count = total_docs
                
                log_message(f"Indexing completed in {duration:.2f} seconds")
                log_message(f"Documents in index: {doc_count}")
                
                # Test retrieval capacity
                if total_docs > 0:
                    try:
                        sample_query = "documentation"
                        log_message(f"Testing retrieval with sample query: '{sample_query}'")
                        results = sparse_retriever.search(sample_query, k=1)
                        log_message(f"Sample query returned {len(results)} results")
                    except Exception as e:
                        log_message(f"Sample query failed: {str(e)}", "WARNING")
                
                response = {
                    "status": "success",
                    "total_files": total_docs,
                    "time_taken": f"{duration:.2f} seconds",
                    "file_paths": file_paths,
                    "document_count": doc_count
                }
                print(json.dumps(response))
            except Exception as e:
                error_msg = str(e)
                log_message(f"Error during indexing: {error_msg}", "ERROR")
                log_message(f"Stack trace: {traceback.format_exc()}", "ERROR")
                response = {
                    "status": "error",
                    "message": f"Error during indexing: {error_msg}",
                    "total_files": total_docs
                }
                print(json.dumps(response))
        else:
            log_message("No documents found to index", "WARNING")
            print(json.dumps({
                "status": "warning",
                "message": "No documents found to index",
                "total_files": 0
            }))
    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        log_message(f"Error during indexing setup: {error_msg}", "ERROR")
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
    global sparse_retriever, indexed, indexed_docs, indexed_files
    
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
        for i, result_item in enumerate(results):
            try:
                if isinstance(result_item, tuple) and len(result_item) == 2:
                    doc_id, score = result_item
                    # Try to convert doc_id to integer
                    try:
                        doc_id = int(doc_id)
                    except (ValueError, TypeError):
                        # If we can't convert to int, use the index
                        doc_id = i
                else:
                    # Unknown format, use index as doc_id and 1.0 as score
                    doc_id, score = i, 1.0
                
                # Ensure doc_id is within range
                if 0 <= doc_id < len(indexed_docs):
                    content = indexed_docs[doc_id]
                    file_path = indexed_files[doc_id] if doc_id < len(indexed_files) else "Unknown"
                else:
                    content = f"[Document #{doc_id} not available]"
                    file_path = "Unknown"
                
                formatted_results.append({
                    "index": doc_id,
                    "score": float(score),
                    "content": content,
                    "content_preview": content[:100] + "..." if len(content) > 100 else content,
                    "file_path": file_path
                })
                log_message(f"Result {i+1}: Document #{doc_id} with score {score:.4f} - {file_path}")
            except Exception as e:
                log_message(f"Error processing result {i}: {str(e)}", "ERROR")
        
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
    
    # Report Python version
    try:
        import platform
        log_message(f"Python version: {platform.python_version()}")
    except Exception as e:
        log_message(f"Could not determine Python version: {str(e)}", "WARNING")
    
    # Check retriv version safely
    try:
        import retriv
        version = "Unknown"
        for attr in ['__version__', 'VERSION', 'version']:
            if hasattr(retriv, attr):
                version = getattr(retriv, attr)
                break
        log_message(f"Using retriv version: {version}")
    except Exception as e:
        log_message(f"Could not determine retriv version: {str(e)}", "WARNING")
    
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