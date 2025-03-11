/**
 * Extract key terms from text for relevance matching
 */
export function extractKeyTerms(text: string): string[] {
  // Remove common stop words
  const stopWords = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 
                    'is', 'are', 'am', 'was', 'were', 'be', 'being', 'been',
                    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
                    'can', 'could', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
                    'who', 'what', 'where', 'when', 'why', 'how', 'which', 'me', 'him', 'her', 'them', 'us'];
  
  // Split into words and filter out stop words and short words
  const words = text.split(/\W+/).filter(word => 
    word.length > 2 && !stopWords.includes(word.toLowerCase())
  );
  
  // Extract unique key terms
  const keyTerms = Array.from(new Set(words));
  
  // Add specific phrases if they exist in the text
  const phrases = [
    'machine learning',
    'deep learning',
    'artificial intelligence',
    'natural language processing',
    'data science',
    'neural network',
    'computer vision',
    'reinforcement learning',
    'software engineering',
    'web development',
    'mobile app',
    'front end',
    'back end',
    'database',
    'full stack'
  ];
  
  for (const phrase of phrases) {
    if (text.toLowerCase().includes(phrase)) {
      keyTerms.push(phrase);
    }
  }
  
  return keyTerms;
}