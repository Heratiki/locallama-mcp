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
retriever = None
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
    Index documents using retriv
    """
    global retriever, indexed, indexed_docs, indexed_files
    
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
        # Try to import retriv correctly
        try:
            from retriv import SparseRetriever
            log_message("Successfully imported retriv.SparseRetriever")
            
            # Create the retriever instance
            retriever = SparseRetriever(
                index_name="locallama-index",
                model="bm25",
                min_df=1,
                tokenizer="whitespace",
                stemmer="english",
                stopwords="english",
                do_lowercasing=True,
                do_ampersand_normalization=True,
                do_special_chars_normalization=True,
                do_acronyms_normalization=True,
                do_punctuation_removal=True,
            )
            
            # Set BM25 hyperparameters if needed
            if k1 != 1.5 or b != 0.75 or epsilon != 0.25:
                if hasattr(retriever, 'hyperparams'):
                    retriever.hyperparams = {
                        "k1": k1,
                        "b": b,
                        "epsilon": epsilon
                    }
                    log_message(f"Set custom BM25 parameters: k1={k1}, b={b}, epsilon={epsilon}")
        except ImportError as e:
            log_message(f"Failed to import retriv.SparseRetriever: {str(e)}", "ERROR")
            raise
        
        log_message("Retriever initialized successfully")
        
        # Collect documents
        text_documents = []
        file_paths = []
        doc_ids = []
        
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
                                        doc_ids.append(f"doc_{len(doc_ids)}")
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
                    doc_ids.append(f"doc_{i}")
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
                # Index the documents - using the indexing approach from the documentation
                # First, prepare documents in the format expected by retriv
                formatted_docs = []
                for i, (doc_text, doc_path) in enumerate(zip(text_documents, file_paths)):
                    formatted_docs.append({
                        "id": doc_ids[i],
                        "text": doc_text
                    })
                
                # Try to index documents directly
                retriever.index(formatted_docs)
                log_message("Documents indexed successfully using direct index method")
                indexed = True
                
                end_time = time.time()
                duration = end_time - start_time
                
                # Check indexed documents count
                doc_count = len(text_documents)
                
                # Test retrieval capacity
                if total_docs > 0:
                    try:
                        sample_query = "documentation" if any("documentation" in doc.lower() for doc in text_documents) else text_documents[0].split()[0]
                        log_message(f"Testing retrieval with sample query: '{sample_query}'")
                        results = retriever.search(sample_query, cutoff=1)
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
                
                # Try alternative indexing method if the direct method failed
                try:
                    log_message("Trying alternative indexing method...")
                    
                    # Create a temporary jsonl file with the documents
                    tmp_file_path = os.path.join(os.getcwd(), "temp_docs_for_indexing.jsonl")
                    with open(tmp_file_path, 'w', encoding='utf-8') as f:
                        for i, (doc_text, doc_path) in enumerate(zip(text_documents, file_paths)):
                            f.write(json.dumps({
                                "id": doc_ids[i],
                                "text": doc_text
                            }) + "\n")
                    
                    # Index from file
                    retriever.index_file(tmp_file_path)
                    os.remove(tmp_file_path)
                    log_message("Documents indexed successfully using file-based method")
                    indexed = True
                    
                    end_time = time.time()
                    duration = end_time - start_time
                    
                    response = {
                        "status": "success",
                        "total_files": total_docs,
                        "time_taken": f"{duration:.2f} seconds",
                        "file_paths": file_paths,
                        "document_count": len(text_documents)
                    }
                    print(json.dumps(response))
                except Exception as e2:
                    log_message(f"Alternative indexing method also failed: {str(e2)}", "ERROR")
                    log_message(f"Stack trace: {traceback.format_exc()}", "ERROR")
                    
                    response = {
                        "status": "error",
                        "message": f"Error during indexing: {error_msg}. Alternative method error: {str(e2)}",
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
    global retriever, indexed, indexed_docs, indexed_files
    
    if not indexed or retriever is None:
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
        
        # Using the search method according to the documentation
        results = retriever.search(query, cutoff=top_k, return_docs=True)
        
        end_time = time.time()
        
        log_message(f"Search completed in {end_time - start_time:.4f} seconds. Found {len(results)} results.")
        
        # Format results for TypeScript
        formatted_results = []
        
        for i, result in enumerate(results):
            try:
                doc_id = result.get("id", "unknown")
                score = result.get("score", 0.0)
                text = result.get("text", "")
                
                # Map the result back to our original files if possible
                file_path = "Unknown"
                try:
                    # Try to get the file path from our indexed files
                    if isinstance(doc_id, str) and doc_id.startswith("doc_"):
                        idx = int(doc_id[4:])  # Extract number from "doc_X"
                        if 0 <= idx < len(indexed_files):
                            file_path = indexed_files[idx]
                except Exception:
                    pass
                
                formatted_results.append({
                    "index": i,  # Use position as index
                    "score": float(score),
                    "content": text,
                    "file_path": file_path
                })
                log_message(f"Result {i+1}: {doc_id} with score {score:.4f} - {file_path}")
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