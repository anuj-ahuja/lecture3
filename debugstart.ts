import { stringifyTree } from './treeprinter';
import { parser } from "lezer-python";
import { parseProgram } from './parser';
import * as compiler from './compiler';

const source = "a:int = 1\n a=2"
const t = parser.parse(source);
console.log(stringifyTree(t.cursor(), source, 0));

const ast = parseProgram(source);
console.log(ast)
const out = compiler.compile(source);
console.log(out);