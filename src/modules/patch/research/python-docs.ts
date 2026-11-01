/** Static source inspection only: never import a researched package or run site hooks. */
export const PYTHON_DOCS_SCRIPT = String.raw`
import ast, importlib.util, json, os, sys, sysconfig, tokenize

def skip(reason):
    print(json.dumps({'text': '', 'skipped': reason}))
    sys.exit(0)

# Discover installation directories without executing site.py or .pth files.
# Load all stdlib dependencies/configuration before adding external search paths.
paths = sysconfig.get_paths()
sys.path.extend(dict.fromkeys([paths['purelib'], paths['platlib']] + sys.argv[2:]))
name = sys.argv[1]
parts = name.split('.')
try:
    # find_spec on a dotted name imports its parent. Only look up the top level.
    spec = importlib.util.find_spec(parts[0])
    if spec is None:
        skip('module_not_found')
    source = spec.origin
    if not source or not source.endswith(('.py', '.pyw')):
        skip('no_python_source')
    locations = list(spec.submodule_search_locations or [])
    for part in parts[1:]:
        source = None
        next_locations = []
        for directory in locations:
            package = os.path.join(directory, part, '__init__.py')
            module = os.path.join(directory, part + '.py')
            if os.path.isfile(package):
                source = package
                next_locations = [os.path.dirname(package)]
                break
            if os.path.isfile(module):
                source = module
                break
        if source is None:
            skip('no_python_source')
        locations = next_locations
    with tokenize.open(source) as stream:
        tree = ast.parse(stream.read(), filename=source)
except (OSError, SyntaxError, ValueError, LookupError, ImportError):
    skip('python_source_unreadable')

lines = ['module ' + name]
def parameters(args):
    positional = args.posonlyargs + args.args
    defaults = [None] * (len(positional) - len(args.defaults)) + args.defaults
    def argument(arg, default=None):
        return ast.unparse(arg) + (' = ' + ast.unparse(default) if default is not None else '')
    pieces = []
    for i, (arg, default) in enumerate(zip(positional, defaults)):
        pieces.append(argument(arg, default))
        if i + 1 == len(args.posonlyargs):
            pieces.append('/')
    if args.vararg:
        pieces.append('*' + argument(args.vararg))
    elif args.kwonlyargs:
        pieces.append('*')
    pieces.extend(argument(arg, default) for arg, default in zip(args.kwonlyargs, args.kw_defaults))
    if args.kwarg:
        pieces.append('**' + argument(args.kwarg))
    return ', '.join(pieces)

def document(node, prefix=''):
    doc = ast.get_docstring(node)
    if doc:
        lines.append(prefix + doc)
    for child in node.body:
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            signature = ('async def ' if isinstance(child, ast.AsyncFunctionDef) else 'def ')
            signature += child.name + '(' + parameters(child.args) + ')'
            if child.returns:
                signature += ' -> ' + ast.unparse(child.returns)
            lines.append(prefix + signature)
            doc = ast.get_docstring(child)
            if doc:
                lines.append(prefix + doc)
        elif isinstance(child, ast.ClassDef):
            bases = [ast.unparse(base) for base in child.bases + child.keywords]
            lines.append(prefix + 'class ' + child.name + ('(' + ', '.join(bases) + ')' if bases else ''))
            document(child, prefix + '  ')

document(tree)
print(json.dumps({'text': '\n'.join(lines)[:1500]}, ensure_ascii=False))
`;
