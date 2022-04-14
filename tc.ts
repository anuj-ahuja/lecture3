import { stringify } from "querystring";
import { BinOp, Expr, Literal, Stmt, Type, VarInit, FuncDef, Parameter, UniOp, Program, Elif } from "./ast";

type TypeEnv = {
  funcs: Map<string, [Type[], Type]>;
  vars: Map<string, Type>;
  retType: Type,
}

export var curBlockRetType : Type;

function duplicateEnv(env: TypeEnv) : TypeEnv {
  return { vars: new Map(env.vars), funcs: new Map(env.funcs), retType: env.retType
  }
}

export function tcLiteral(literal: Literal<null>) : Literal<Type> {
  switch(literal.tag) {
    case "number": return { ...literal, a: "int" }
    case "true": return { ...literal, a: "bool" }
    case "false": return { ...literal, a: "bool" }
    case "none": return { ...literal, a: "none" }
  }
}

export function tcVarInits(inits: VarInit<null>[], env : TypeEnv) : VarInit<Type>[] {

  const typedInits : VarInit<Type>[] = [];
  inits.forEach((init) => {
    typedInits.push(tcVarInit(init, env));
  })

  return typedInits
}

export function tcVarInit(init: VarInit<null>, env : TypeEnv) : VarInit<Type> {

  const typedInit = tcLiteral(init.init);
  if (typedInit.a !== init.type)
    throw new Error('TYPE ERROR: init type does not match literal type')
  env.vars.set(init.name, init.type);

  return {...init, a: init.type, init: typedInit}
}

export function tcFuncDef(func: FuncDef<null>, env: TypeEnv) : FuncDef<Type> {
  const localEnv = duplicateEnv(env);

  // add params to env
  func.parameters.forEach((param) => {
    localEnv.vars.set(param.name, param.typ);
  })
  const typedParams = tcParams(func.parameters)

  // add inits to env
  const typedInits = tcVarInits(func.inits, env);
  func.inits.forEach((init) => {
    localEnv.vars.set(init.name, init.type);
  })

  // add function type in env
  localEnv.funcs.set(func.name, [func.parameters.map((param) => param.typ), func.ret])

  // add return type to env
  localEnv.retType = func.ret;

  // type check body
  const typedStmts = tcStmts(func.body, localEnv)

  if (curBlockRetType !== func.ret) {
    throw new Error(`All paths must return ${func.ret}`)
  }
  curBlockRetType = "none";

  return { ...func, parameters: typedParams, inits: typedInits, body: typedStmts, a: func.ret}
}

export function tcParams(params: Parameter<null>[]) : Parameter<Type>[] {
  const paramsSet = new Set();
  return params.map(param => {
    if (paramsSet.has(param.name)) {
      throw new Error(`Duplicate param names ${param.name}`)
    }
    paramsSet.add(param.name);
    return {...param, a: param.typ}}
    );
}

export function tcExpr(e : Expr<null>, env : TypeEnv) : Expr<Type> {
  switch(e.tag) {

    case "literal": 
      const lit = tcLiteral(e.literal);
      return { ...e, literal: lit, a: lit.a };

    case "uniop":
      const typedArg = tcExpr(e.arg, env);
      if (e.op === UniOp.Minus && typedArg.a !== "int") {
        throw new Error(`Cannot apply operator ${e.op} for type ${typedArg.a}`)
      }
      if (e.op === UniOp.Not && typedArg.a !== "bool") {
        throw new Error(`Cannot apply operator ${e.op} for type ${typedArg.a}`)
      }
      
      return { ...e, a: typedArg.a, arg: typedArg}
    
    case "binop":
      const left = tcExpr(e.arg1, env);
      const right = tcExpr(e.arg2, env);
      var resultType : Type;

      if (e.op === BinOp.Plus || e.op === BinOp.Minus || e.op === BinOp.Mul || e.op === BinOp.Div
        || e.op === BinOp.Rem || e.op === BinOp.Gt || e.op === BinOp.Gte || e.op === BinOp.Lt
        || e.op === BinOp.Lte) {
          if (left.a !== "int" || right.a !== "int" ) {
            throw new Error(`Cannot apply operator ${e.op} to types ${left.a} and ${right.a}`)
          }
        } else if (e.op === BinOp.Eq || e.op === BinOp.Neq) {
          if (left.a !== right.a) {
            throw new Error(`Cannot apply operator ${e.op} to types ${left.a} and ${right.a}`)
          }
        } else {
          if (left.a !== "none" || right.a !== "none") {
            throw new Error(`Cannot apply operator ${e.op} to types ${left.a} and ${right.a}`)
          }
        }

        if (e.op === BinOp.Plus || e.op === BinOp.Minus || e.op === BinOp.Mul || e.op === BinOp.Div) {
          resultType = "int"
        } else {
          resultType = "bool"
        }

      return { ...e, a: resultType, arg1: left, arg2: right}

    case "id": 
      if (!env.vars.has(e.name))
        throw new Error('TYPE ERROR: unbound id')
      return { ...e, a: env.vars.get(e.name) }

    case "call":
      if(e.name === "print") {
        if(e.arguments.length !== 1) { throw new Error("print expects a single argument"); }
        const newArgs = [tcExpr(e.arguments[0], env)];
        const res : Expr<Type> = { ...e, a: "none", arguments: newArgs } ;
        return res;
      }

      if(!env.funcs.has(e.name)) {
        throw new Error(`function ${e.name} not found`);
      }

      const [args, ret] = env.funcs.get(e.name);
      if(args.length !== e.arguments.length) {
        throw new Error(`Expected ${args.length} arguments but got ${e.arguments.length}`);
      }
      const typedArgs : Expr<Type>[] = [];
      args.forEach((a, i) => {
        const typedArg = tcExpr(e.arguments[i], env);
        if(a !== typedArg.a) { throw new Error(`Got ${typedArg.a} as argument ${i + 1}, expected ${a}`); }
        typedArgs.push(typedArg);
      });

      return {...e, arguments: typedArgs, a: ret};
  }
}

export function tcElseifs(elseifs : Elif<null>[], env: TypeEnv) : Elif<Type>[] {

  var typedElif = elseifs.map(e => {
    const typedCond = tcExpr(e.cond, env);
    
    if (typedCond.a !== 'bool') {
      throw new Error('If condition must be boolean')
    }

    const typedBody = tcStmts(e.body, env);
    return {...e, cond: typedCond, body: typedBody }
  })

  return typedElif
}

export function tcStmts(stmts : Stmt<null>[], env: TypeEnv) : Stmt<Type>[] {
  const typedStmts : Stmt<Type>[] = [];

  stmts.forEach(s => {
    switch(s.tag) {
      case "assign": {
        const typedValue = tcExpr(s.value, env);

        if (!env.vars.has(s.name))
          throw new Error("TYPE ERROR: unbound id")
        
        if(env.vars.get(s.name) !== typedValue.a) {
          throw new Error(`Cannot assign ${typedValue.a} to ${env.vars.get(s.name)}`);
        }
        typedStmts.push({...s, value: typedValue, a: "none"})
        break;
      }
      case "while": {
        const typedCond = tcExpr(s.cond, env);
        if (typedCond.a !== "bool") {
          throw new Error(`While condition cannot have a type ${typedCond.a}`)
        }
        const typedBody = tcStmts(s.body, env);
        curBlockRetType = "none";

        typedStmts.push({ ...s, cond: typedCond, body: typedBody, a: "none"});
        break;

      }
      case "if": {
        const typedIfCond = tcExpr(s.cond, env);
        if (typedIfCond.a !== 'bool') {
          throw new Error('If condition must be boolean')
        }
        var isIfTypeMatch  : Boolean = false;
        var isElifTypeMatch : Boolean = false;
        var isElseTypeMatch : Boolean = false;
        var ifType  : Type;
        var elifType : Type;
        var elseType : Type;
        var ifRet : Type;

        const typedIfBody = tcStmts(s.body, env);
        ifType = curBlockRetType;
        if (curBlockRetType == env.retType) {
          isIfTypeMatch = true;
        }
        curBlockRetType = "none";

        const typedElseifs = tcElseifs(s.elifs, env);
        elifType = curBlockRetType;
        if (curBlockRetType == env.retType) {
          isElifTypeMatch = true;
        }
        
        curBlockRetType = "none";
        const typedElse = tcStmts(s.elsebody, env);
        elseType = curBlockRetType;
        if (curBlockRetType == env.retType) {
          isElseTypeMatch = true;
        }

        curBlockRetType = "none";
        // find return type not consistent
        if (isIfTypeMatch && (isElifTypeMatch || s.elifs.length === 0) && isElseTypeMatch) {
          ifRet = ifType;
        } else {
          if (!isIfTypeMatch) {
            ifRet = ifType;
          } else if (!isElifTypeMatch) {
            ifRet = elifType;
          } else {
            ifRet = elseType;
          }
        }

        typedStmts.push({...s, cond: typedIfCond, body: typedIfBody, elsebody: typedElse, elifs: typedElseifs, a: ifRet})
      }
      break;

      case "expr": {
        const typedExpr = tcExpr(s.expr, env);
        typedStmts.push({...s, expr: typedExpr, a: typedExpr.a})
        break;
      }
      case "return": {
        const typedRet = tcExpr(s.value, env);
        if(typedRet.a !== env.retType) {
          throw new Error(`${typedRet.a} returned but ${env.retType} expected.`);
        }
        typedStmts.push({...s, value: typedRet, a: typedRet.a})
        break;
      }
      case "pass": {
        typedStmts.push({ ...s, a: "none" });
        break;
      }
    }
  })

  // set return type of these set of statements
  // set in env
  typedStmts.forEach(t => {
    if (t.tag === "if" || t.tag === "return") {
      if (t.a === env.retType) {
        curBlockRetType = t.a;
      }
    }
  })

  return typedStmts;
}

export function tcFuncsDef(funcdefs : FuncDef<null>[], env: TypeEnv) : FuncDef<Type>[] {

  var typedFuncs : FuncDef<Type>[] = [];

  funcdefs.forEach(f => {
    typedFuncs.push(tcFuncDef(f, env))
  });

  return typedFuncs;
}

export function tcProgram(p : Program<null>) : Program<Type> {
  var typeEnv : TypeEnv = {funcs: new Map<string, [Type[], Type]>(), vars: new Map<string, Type>(), retType: "none"};
  
  // add builtin functions
  ["min", "max", "pow"].forEach(s => {
    typeEnv.funcs.set(s, [["int", "int"], "int"]);
  });

  typeEnv.funcs.set("abs", [["int"], "int"]);

  // add user defined functions
  p.fundefs.forEach(f => {
    if (typeEnv.funcs.has(f.name)) {
      throw new Error(`Function with name ${f.name} already exists`)
    }
    typeEnv.funcs.set(f.name, [f.parameters.map(p => p.typ), f.ret]);
  });

  // type check functions & var inits & stmts


  // const globals = new Map<string, Type>();
  return {a: "none", varinits: tcVarInits(p.varinits, typeEnv), fundefs: tcFuncsDef(p.fundefs, typeEnv), stmts: tcStmts(p.stmts, typeEnv)}
}