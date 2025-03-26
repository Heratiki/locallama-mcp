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

def process_configure_retriever_command(command_data):
    """
    Configure the retriever with parameters passed from TypeScript
    """
    global retriever
    
    retriever_type = command_data.get("retriever_type", "sparse")
    bm25_options = command_data.get("bm25_options", {})
    text_preprocessing_options = command_data.get("text_preprocessing_options", {})
    dense_retriever_options = command_data.get("dense_retriever_options", {})
    hybrid_retriever_options = command_data.get("hybrid_retriever_options", {})
    
    log_message(f"Configuring {retriever_type} retriever")
    
    try:
        # Create a new retriever with the provided options
        if retriever_type == "dense":
            try:
                from retriv import DenseRetriever
                
                # Extract dense retriever options
                model = dense_retriever_options.get("model", "sentence-transformers/all-MiniLM-L6-v2")
                normalize = dense_retriever_options.get("normalize", True)
                max_length = dense_retriever_options.get("max_length", 128)
                use_ann = dense_retriever_options.get("use_ann", True)
                
                log_message(f"Initializing DenseRetriever with model='{model}', normalize={normalize}, max_length={max_length}, use_ann={use_ann}")
                
                retriever = DenseRetriever(
                    index_name="locallama-index",
                    model=model,
                    normalize=normalize,
                    max_length=max_length,
                    use_ann=use_ann
                )
                
                log_message("DenseRetriever configured successfully")
                
            except ImportError as e:
                log_message(f"Failed to import DenseRetriever: {str(e)}", "ERROR")
                print(json.dumps({
                    "status": "error",
                    "message": f"Failed to import DenseRetriever: {str(e)}"
                }))
                return
                
        elif retriever_type == "hybrid":
            try:
                from retriv import HybridRetriever
                
                # Extract hybrid retriever options
                sr_model = hybrid_retriever_options.get("sr_model", "bm25")
                dr_model = hybrid_retriever_options.get("dr_model", "sentence-transformers/all-MiniLM-L6-v2")
                min_df = hybrid_retriever_options.get("min_df", 1)
                tokenizer = hybrid_retriever_options.get("tokenizer", "whitespace")
                stemmer = hybrid_retriever_options.get("stemmer", "english")
                stopwords = hybrid_retriever_options.get("stopwords", "english")
                do_lowercasing = hybrid_retriever_options.get("do_lowercasing", True)
                do_ampersand_normalization = hybrid_retriever_options.get("do_ampersand_normalization", True)
                do_special_chars_normalization = hybrid_retriever_options.get("do_special_chars_normalization", True)
                do_acronyms_normalization = hybrid_retriever_options.get("do_acronyms_normalization", True)
                do_punctuation_removal = hybrid_retriever_options.get("do_punctuation_removal", True)
                normalize = hybrid_retriever_options.get("normalize", True)
                max_length = hybrid_retriever_options.get("max_length", 128)
                use_ann = hybrid_retriever_options.get("use_ann", True)
                
                log_message(f"Initializing HybridRetriever with sr_model='{sr_model}', dr_model='{dr_model}'")
                
                retriever = HybridRetriever(
                    index_name="locallama-index",
                    sr_model=sr_model,
                    min_df=min_df,
                    tokenizer=tokenizer,
                    stemmer=stemmer,
                    stopwords=stopwords,
                    do_lowercasing=do_lowercasing,
                    do_ampersand_normalization=do_ampersand_normalization,
                    do_special_chars_normalization=do_special_chars_normalization,
                    do_acronyms_normalization=do_acronyms_normalization,
                    do_punctuation_removal=do_punctuation_removal,
                    dr_model=dr_model,
                    normalize=normalize,
                    max_length=max_length,
                    use_ann=use_ann
                )
                
                log_message("HybridRetriever configured successfully")
                
            except ImportError as e:
                log_message(f"Failed to import HybridRetriever: {str(e)}", "ERROR")
                print(json.dumps({
                    "status": "error",
                    "message": f"Failed to import HybridRetriever: {str(e)}"
                }))
                return
                
        else:  # Default to SparseRetriever
            try:
                from retriv import SparseRetriever
                
                # Extract sparse retriever options
                model = "bm25"  # Default model
                min_df = text_preprocessing_options.get("min_df", 1)
                tokenizer = text_preprocessing_options.get("tokenizer", "whitespace")
                stemmer = text_preprocessing_options.get("stemmer", "english")
                stopwords = text_preprocessing_options.get("stopwords", "english")
                do_lowercasing = text_preprocessing_options.get("do_lowercasing", True)
                do_ampersand_normalization = text_preprocessing_options.get("do_ampersand_normalization", True)
                do_special_chars_normalization = text_preprocessing_options.get("do_special_chars_normalization", True)
                do_acronyms_normalization = text_preprocessing_options.get("do_acronyms_normalization", True)
                do_punctuation_removal = text_preprocessing_options.get("do_punctuation_removal", True)
                
                log_message(f"Initializing SparseRetriever with model='bm25', min_df={min_df}, tokenizer='{tokenizer}', stemmer='{stemmer}'")
                
                retriever = SparseRetriever(
                    index_name="locallama-index",
                    model=model,
                    min_df=min_df,
                    tokenizer=tokenizer,
                    stemmer=stemmer,
                    stopwords=stopwords,
                    do_lowercasing=do_lowercasing,
                    do_ampersand_normalization=do_ampersand_normalization,
                    do_special_chars_normalization=do_special_chars_normalization,
                    do_acronyms_normalization=do_acronyms_normalization,
                    do_punctuation_removal=do_punctuation_removal
                )
                
                # Extract BM25 parameters
                k1 = bm25_options.get("k1", 1.5)
                b = bm25_options.get("b", 0.75)
                epsilon = bm25_options.get("epsilon", 0.25)
                
                # Set BM25 hyperparameters
                retriever.hyperparams = {
                    "k1": k1,
                    "b": b,
                    "epsilon": epsilon
                }
                
                log_message(f"Set custom BM25 parameters: k1={k1}, b={b}, epsilon={epsilon}")
                log_message("SparseRetriever configured successfully")
                
            except ImportError as e:
                log_message(f"Failed to import SparseRetriever: {str(e)}", "ERROR")
                print(json.dumps({
                    "status": "error",
                    "message": f"Failed to import SparseRetriever: {str(e)}"
                }))
                return
        
        # Reset indexed status since we've created a new retriever
        global indexed
        indexed = False
        
        print(json.dumps({
            "status": "success",
            "message": f"Successfully configured {retriever_type} retriever"
        }))
        
    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        log_message(f"Error configuring retriever: {error_msg}", "ERROR")
        log_message(f"Stack trace: {stack_trace}", "ERROR")
        print(json.dumps({
            "status": "error",
            "message": error_msg,
            "stack_trace": stack_trace
        }))

def process_index_command(command_data):
    """
    Index documents using retriv
    """
    global retriever, indexed, indexed_docs, indexed_files
    
    directories = command_data.get("directories", [])
    documents = command_data.get("documents", [])
    options = command_data.get("options", {})
    retriever_type = command_data.get("retriever_type", "sparse")  # sparse, dense, or hybrid
    
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
        # Initialize retriever if it doesn't exist yet
        if retriever is None:
            # Import retriv based on retriever type
            if retriever_type == "dense":
                try:
                    from retriv import DenseRetriever
                    log_message(f"Using DenseRetriever with model='sentence-transformers/all-MiniLM-L6-v2'")
                    retriever = DenseRetriever(
                        index_name="locallama-index",
                        model="sentence-transformers/all-MiniLM-L6-v2",
                        normalize=True,
                        max_length=128,
                        use_ann=True
                    )
                except ImportError as e:
                    log_message(f"Failed to import DenseRetriever: {str(e)}", "ERROR")
                    raise
            elif retriever_type == "hybrid":
                try:
                    from retriv import HybridRetriever
                    log_message("Using HybridRetriever")
                    retriever = HybridRetriever(
                        index_name="locallama-index",
                        sr_model="bm25",
                        min_df=1,
                        tokenizer="whitespace",
                        stemmer="english",
                        stopwords="english",
                        do_lowercasing=True,
                        do_ampersand_normalization=True,
                        do_special_chars_normalization=True,
                        do_acronyms_normalization=True,
                        do_punctuation_removal=True,
                        dr_model="sentence-transformers/all-MiniLM-L6-v2",
                        normalize=True,
                        max_length=128,
                        use_ann=True
                    )
                except ImportError as e:
                    log_message(f"Failed to import HybridRetriever: {str(e)}", "ERROR")
                    raise
            else:  # Default to SparseRetriever
                try:
                    from retriv import SparseRetriever
                    log_message("Using SparseRetriever")
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
                        do_punctuation_removal=True
                    )
                    # Set BM25 hyperparameters if needed
                    retriever.hyperparams = {
                        "k1": k1,
                        "b": b,
                        "epsilon": epsilon
                    }
                    log_message(f"Set custom BM25 parameters: k1={k1}, b={b}, epsilon={epsilon}")
                except ImportError as e:
                    log_message(f"Failed to import SparseRetriever: {str(e)}", "ERROR")
                    raise
            
            log_message(f"Initialized {retriever_type.capitalize()}Retriever successfully")
        
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
                                        text_documents.append({
                                            "id": f"doc_{len(doc_ids)}",
                                            "text": content
                                        })
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
                    text_documents.append({
                        "id": f"doc_{i}",
                        "text": doc
                    })
                    file_paths.append(f"document_{i}")
                    doc_ids.append(f"doc_{i}")
                    log_message(f"Added document #{i} ({len(doc)} bytes)")
                else:
                    log_message(f"Skipping empty document #{i}", "WARNING")
        
        # Store original text content for later use in search
        indexed_docs = [doc["text"] for doc in text_documents]
        indexed_files = file_paths
        
        total_docs = len(text_documents)
        log_message(f"Collected {total_docs} total documents for indexing")
        
        if text_documents:
            log_message(f"Starting indexing of {total_docs} documents...")
            start_time = time.time()
            
            try:
                # Handle different indexing methods based on retriever type
                if retriever_type == "dense":
                    # For dense and hybrid retrievers, we need to specify batch_size
                    retriever.index(text_documents)
                    log_message("Documents indexed using DenseRetriever")
                elif retriever_type == "hybrid":
                    retriever.index(text_documents)
                    log_message("Documents indexed using HybridRetriever")
                else:
                    # For sparse retriever
                    retriever.index(text_documents)
                    log_message("Documents indexed using SparseRetriever")
                
                indexed = True
                end_time = time.time()
                duration = end_time - start_time
                
                # Test retrieval capacity
                if total_docs > 0:
                    try:
                        sample_query = "documentation" if any("documentation" in doc["text"].lower() for doc in text_documents) else text_documents[0]["text"].split()[0]
                        log_message(f"Testing retrieval with sample query: '{sample_query}'")
                        results = retriever.search(sample_query, top_k=1)
                        log_message(f"Sample query returned {len(results)} results")
                    except Exception as e:
                        log_message(f"Sample query failed: {str(e)}", "WARNING")
                
                response = {
                    "status": "success",
                    "total_files": total_docs,
                    "time_taken": f"{duration:.2f} seconds",
                    "file_paths": file_paths,
                    "document_count": total_docs
                }
                print(json.dumps(response))
            except Exception as e:
                error_msg = str(e)
                log_message(f"Error during indexing: {error_msg}", "ERROR")
                log_message(f"Stack trace: {traceback.format_exc()}", "ERROR")
                
                # Try alternative indexing method using a temporary file
                try:
                    log_message("Trying alternative indexing method with temporary file...")
                    
                    # Create a temporary jsonl file with the documents
                    tmp_file_path = os.path.join(os.getcwd(), "temp_docs_for_indexing.jsonl")
                    with open(tmp_file_path, 'w', encoding='utf-8') as f:
                        for doc in text_documents:
                            f.write(json.dumps(doc) + "\n")
                    
                    # Index from file
                    retriever.index_file(tmp_file_path)
                    os.remove(tmp_file_path)  # Clean up
                    log_message("Documents indexed successfully using file-based method")
                    indexed = True
                    
                    end_time = time.time()
                    duration = end_time - start_time
                    
                    response = {
                        "status": "success",
                        "total_files": total_docs,
                        "time_taken": f"{duration:.2f} seconds",
                        "file_paths": file_paths,
                        "document_count": total_docs
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
        
        # Use the retriever's search method with return_docs=True to get full document content
        results = retriever.search(query, cutoff=top_k, return_docs=True)
        
        end_time = time.time()
        
        log_message(f"Search completed in {end_time - start_time:.4f} seconds. Found {len(results)} results.")
        
        # Format results for TypeScript
        formatted_results = []
        
        for i, result in enumerate(results):
            try:
                # Handle the different result formats from different retrievers
                if isinstance(result, dict):
                    # Format used by retriv library
                    doc_id = result.get("id", f"doc_{i}")
                    score = result.get("score", 0.0)
                    content = result.get("text", "")
                    
                    # Try to map doc_id back to original file path
                    file_path = "Unknown"
                    try:
                        if isinstance(doc_id, str) and doc_id.startswith("doc_"):
                            idx = int(doc_id[4:])
                            if 0 <= idx < len(indexed_files):
                                file_path = indexed_files[idx]
                    except:
                        pass
                else:
                    # Legacy tuple format (doc_id, score)
                    doc_id, score = result if isinstance(result, tuple) and len(result) == 2 else (f"result_{i}", 1.0)
                    
                    # Try to convert doc_id to integer index
                    try:
                        idx = int(doc_id) if isinstance(doc_id, str) and doc_id.isdigit() else int(doc_id)
                        content = indexed_docs[idx] if 0 <= idx < len(indexed_docs) else f"[Content not available for {doc_id}]"
                        file_path = indexed_files[idx] if 0 <= idx < len(indexed_files) else "Unknown"
                    except:
                        content = f"[Content not available for {doc_id}]"
                        file_path = "Unknown"
                
                formatted_results.append({
                    "index": i,
                    "score": float(score),
                    "content": content,
                    "file_path": file_path
                })
                log_message(f"Result {i+1}: doc_id={doc_id} with score {score:.4f} - {file_path}")
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
    
    # Print available retrievers
    try:
        available_retrievers = []
        try:
            from retriv import SparseRetriever
            available_retrievers.append("SparseRetriever")
        except ImportError:
            pass
        
        try:
            from retriv import DenseRetriever
            available_retrievers.append("DenseRetriever")
        except ImportError:
            pass
        
        try:
            from retriv import HybridRetriever
            available_retrievers.append("HybridRetriever")
        except ImportError:
            pass
        
        log_message(f"Available retrievers: {', '.join(available_retrievers)}")
    except Exception as e:
        log_message(f"Error checking available retrievers: {str(e)}", "WARNING")
    
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
            elif action == "configure_retriever":
                process_configure_retriever_command(command)
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
