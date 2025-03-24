import * as ts from 'typescript';

class CodeValidator {
  public validateSyntax(code: string): boolean {
    try {
      // Create a source file
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );
      
      // If parsing succeeded without errors, syntax is valid
      return sourceFile !== undefined;
    } catch {
      return false;
    }
  }

  public validateStyle(code: string): boolean {
    try {
      // Basic style checks
      const lines = code.split('\n');
      
      for (const line of lines) {
        // Check line length (max 120 characters)
        if (line.length > 120) return false;
        
        // Check indentation (must be spaces or tabs, but consistent)
        const indentMatch = line.match(/^[\t ]*(?=\S)/);
        if (indentMatch && indentMatch[0].includes(' ') && indentMatch[0].includes('\t')) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }

  public validateSecurity(code: string): boolean {
    try {
      // Basic security checks
      const containsDangerousPatterns = code.includes('eval(') ||
        code.includes('new Function(') ||
        code.includes('process.env') ||
        code.includes('__proto__') ||
        /innerHTML\s*=/.test(code);

      return !containsDangerousPatterns;
    } catch {
      return false;
    }
  }

  public validateBestPractices(code: string): boolean {
    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      let hasIssues = false;

      // Visit each node in the AST
      const visit = (node: ts.Node) => {
        // Check for any usage
        if (ts.isIdentifier(node) && node.text === 'any') {
          hasIssues = true;
        }
        
        // Check for console.log
        if (ts.isPropertyAccessExpression(node) &&
            node.expression.getText() === 'console' &&
            node.name.getText() === 'log') {
          hasIssues = true;
        }
        
        // Continue visiting child nodes
        ts.forEachChild(node, visit);
      };

      ts.forEachChild(sourceFile, visit);
      
      return !hasIssues;
    } catch {
      return false;
    }
  }
}

export default CodeValidator;
