import wabt from 'wabt';
import {Stmt, Expr, BinOp, Literal, VarInit, Type, UniOp, FuncDef} from './ast';
import {parseProgram, traverseExpr} from './parser';
import { tcProgram } from './tc';

var globals = new Map();

export async function run(watSource : string, config: any) : Promise<number> {
  const wabtApi = await wabt();
  const importObject = config.importObject;

  // Next three lines are wat2wasm
  const parsed = wabtApi.parseWat("example", watSource);
  const binary = parsed.toBinary({});
  const wasmModule = await WebAssembly.instantiate(binary.buffer, importObject);

  // This next line is wasm-interp
  return (wasmModule.instance.exports as any)._start();
}

// (window as any)["runWat"] = run;

export function codeGenLiteral(literal: Literal<Type>) : Array<string> {
  switch(literal.tag) {
    case "number": return [`(i32.const ${literal.value})`];
    case "true": return [`(i32.const 1)`];
    case "false": return [`(i32.const 0)`]
    case "none": return [`(i32.const 2147483648)`] // 2^31
  }
}

export function codeGenUniop(uniop: UniOp) : Array<string> {
  switch(uniop) {
    case UniOp.Minus:
      return ['(i32.const -1)', '(i32.mul)']
    case UniOp.Not:
      return ['(i32.const 1)', '(i32.xor)']
  }
}

export function getVarScope(name: string) : string {
  if (globals.has(name)) { return "global"; }
  else {return "local";}
}

export function codeGenExpr(expr : Expr<Type>) : Array<string> {
  switch(expr.tag) {
    case "id": 
      return [`(${getVarScope(expr.name)}.get $${expr.name})`];
    case "literal": return codeGenLiteral(expr.literal);
    case "call":
      const valStmts = expr.arguments.map(codeGenExpr).flat();
      let toCall = expr.name;
      if(expr.name === "print") {
        switch(expr.arguments[0].a) {
          case "bool": toCall = "print_bool"; break;
          case "int": toCall = "print_num"; break;
          case "none": toCall = "print_none"; break;
        }
      }
      valStmts.push(`(call $${toCall})`);
      return valStmts;
    case "binop":
      const left = codeGenExpr(expr.arg1);
      const right = codeGenExpr(expr.arg2);
      const opStmt = codeGenBinOp(expr.op);
      return [...left, ...right, opStmt]
    case "uniop":
      const arg = codeGenExpr(expr.arg);
      const uniOp = codeGenUniop(expr.op);
      return arg.concat(uniOp);
  }
}
export function codeGenStmt(stmt : Stmt<Type>) : Array<string> {
  switch(stmt.tag) {
    case "pass":
      return ["(nop)", ``];
    case "if":
      const codeExpr = codeGenExpr(stmt.cond);
      let out = codeExpr.concat(['(if']).concat(['(then']);
      const body = codeGenStmts(stmt.body);
      out = out.concat(body).concat([')']);
      const elsebody = codeGenStmts(stmt.elsebody);
      if (stmt.elifs.length !== 0) {
        stmt.elifs.forEach(elif => {
          const elifCodeExpr = codeGenExpr(elif.cond);
          out = out.concat(['(else']).concat(elifCodeExpr).concat(['(if']).concat(['(then']);
          const elifBody = codeGenStmts(elif.body);
          out = out.concat(elifBody).concat([')'])
        })
      }
      if (elsebody.length !== 0) { 
        out = out.concat(['(else']).concat([elsebody.join(' ')]).concat([')'])
      }

      out.push(")\n".repeat(stmt.elifs.length*2));
      out = out.concat([')']);
      return out;

    case "while":
      let whileWasm = [].concat(['(block $my_block (loop $my_loop']);
      whileWasm =  whileWasm.concat(codeGenExpr(stmt.cond));

      // not the condition since br_if runs if condition true but we what other way
      whileWasm = whileWasm.concat(['(i32.const 1)']).concat(['(i32.xor)']).concat(['(br_if $my_block)']);

      // add while body 
      stmt.body.forEach(b => {
        whileWasm = whileWasm.concat(codeGenStmt(b));
      })

      // go back to the loop start
      whileWasm = whileWasm.concat(['(br $my_loop)']).concat(['))'])
      return whileWasm;

    case "return":
      var valStmts = codeGenExpr(stmt.value);
      valStmts.push("return");
      return valStmts;
    // case "varinit":
      // return codeGenVarInit(stmt.varinit);
    case "assign":
      var valStmts = codeGenExpr(stmt.value);
      valStmts.push(`(${getVarScope(stmt.name)}.set $${stmt.name})`);
      return valStmts;
    case "expr":
      const result = codeGenExpr(stmt.expr);
      result.push("(local.set $scratch)");
      return result;
  }
}

export function codeGenFunc(func: FuncDef<Type>) : Array<string> {
  const params = func.parameters.map(p => `(param $${p.name} i32)`).join(" ");
  const varInitFuncStmts = func.inits.map(codeGenVarInit).flat().join("\n");
  const funcVars:Array<String> = [];
  func.inits.forEach(v => { funcVars.push(`(local $${v.name} i32)`); }); // assuming no global declarations in functions
  const stmts = func.body.map(codeGenStmt).flat();
  const stmtsBody = stmts.join("\n");
  return [`(func $${func.name} ${params} (result i32)
    (local $scratch i32)
    ${funcVars}
    ${varInitFuncStmts}
    ${stmtsBody}
    (i32.const 0))`];
}

export function codeGenVarInit(varinit: VarInit<Type>): Array<string> {
  var varInitStmts = codeGenLiteral(varinit.init)
  varInitStmts.push(`(${getVarScope(varinit.name)}.set $${varinit.name})`)
  return varInitStmts;
}

export function codeGenStmts(stmts: Array<Stmt<Type>>): Array<string> {
  let stmtsCode:string[] = [];
  stmts.forEach(stmt => {
    const stmtCode = codeGenStmt(stmt);
    stmtsCode = stmtsCode.concat(stmtCode);
  })
  return stmtsCode;
}

export function compile(source : string) : string {
  const ast = parseProgram(source);
  const typedAst = tcProgram(ast);
  console.log(typedAst)
  // const vars : Array<string> = [];
  typedAst.varinits.forEach((varinit) => {
    globals.set(varinit.name, varinit.init);
  });
  const funs : Array<string> = [];
  typedAst.fundefs.forEach((func, i) => {
    funs.push(codeGenFunc(func).join("\n"));
  });
  const allFuns = funs.join("\n\n");
  const stmts = typedAst.stmts;

  // global vars
  let globalDecls : Array<string> = [];
  globals.forEach((val, key) => { globalDecls = globalDecls.concat(`(global $${key} (mut i32) `).concat(codeGenLiteral(val)).concat([')']); });
  
  const varDecls : Array<string> = [];
  varDecls.push(`(local $scratch i32)`);

  const allStmts = stmts.map(codeGenStmt).flat();
  const ourCode = varDecls.concat(allStmts).join("\n");

  const lastStmt = stmts[stmts.length - 1];
  const isExpr = lastStmt.tag === "expr";
  var retType = "";
  var retVal = "";
  if(isExpr) {
    retType = "(result i32)";
    retVal = "(local.get $scratch)"
  }

  return `
    (module
    (func $print (import "imports" "print") (param i32) (result i32))
    (func $print_num (import "imports" "print_num") (param i32) (result i32))
    (func $print_bool (import "imports" "print_bool") (param i32) (result i32))
    (func $print_none (import "imports" "print_none") (param i32) (result i32))
    (func $abs (import "imports" "abs") (param i32) (result i32))
    (func $max (import "imports" "max") (param i32 i32) (result i32))
    (func $min (import "imports" "min") (param i32 i32) (result i32))
    (func $pow (import "imports" "pow") (param i32 i32) (result i32))

      ${globalDecls.join("")}
      ${allFuns}
      (func (export "_start") ${retType}
        ${ourCode}
        ${retVal}
      )
    ) 
  `;
}

function codeGenBinOp(op: BinOp) : string {
  switch(op) {
    case BinOp.Plus:
      return "(i32.add)"
    case BinOp.Mul:
      return "(i32.mul)"
    case BinOp.Minus:
      return "(i32.sub)"
    case BinOp.Div:
      return "(i32.div_u)"
    case BinOp.Rem:
      return "(i32.rem_u)"
    case BinOp.Eq:
      return "(i32.eq)"
    case BinOp.Neq:
      return "(i32.ne)"
    case BinOp.Gte:
      return "(i32.ge_u)"
    case BinOp.Lte:
      return "(i32.le_u)"
    case BinOp.Gt:
      return "(i32.gt_u)"
    case BinOp.Lt:
      return "(i32.lt_u)"
    case BinOp.Is:
      return "(i32.eq)"
  }
}