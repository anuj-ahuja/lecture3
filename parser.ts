import { TreeCursor } from 'lezer';
import {parser} from 'lezer-python';
import {Parameter, Stmt, Expr, Type, Elif, BinOp, Literal, UniOp, VarInit, FuncDef, Program} from './ast';

export function parseProgram(source : string) : Program<null> {
  const t = parser.parse(source).cursor();

  
  var varInits : Array<VarInit<null>> = [];
  var funcDefs : Array<FuncDef<null>> = [];
  var parsedStmts : Array<Stmt<null>> = [];

  t.firstChild();

  // parse var defs and funcs defs
  do {
    if (isVarDec(source, t)) {
      varInits.push(traverseVarInit(source, t));
    } else if (isFuncDef(source, t)) {
      funcDefs.push(traverseFuncDef(source, t));
    } else {
      break;
    }
  } while (t.nextSibling());

  // check if stmts don't exisit
  if (!isVarDec(source, t) && !isFuncDef(source, t)) {
    // parse var stmts
    do {
      if (isVarDec(source, t) || isFuncDef(source, t)) {
        throw new Error('PARSE ERROR: Cannot have variable/function definition after statements')
      }
      parsedStmts.push(traverseStmt(source, t));
    } while(t.nextSibling());
  }

  return { varinits: varInits, fundefs: funcDefs, stmts: parsedStmts}
}

export function isVarDec(s: string, t: TreeCursor) : Boolean {
  t.firstChild();
  t.nextSibling(); 

  if (s.substring(t.from, t.from+1) === ':') {
    t.parent();
    return true;
  } else {
    t.parent();
    return false;
  }
}

export function isFuncDef(s: string, t: TreeCursor) : Boolean {
  if (t.type.name === "FunctionDefinition") {
    return true;
  } else {
    return false;
  }
}

export function traverseVarInit(s: string, t: TreeCursor) : VarInit<null> {
  t.firstChild(); // focused on name (the first child)
  var name = s.substring(t.from, t.to);
  t.nextSibling(); // focused on = sign or :. May need this for complex tasks, like +=!
  var type: Type = "none";

  let typeString = s.substring(t.from+1, t.to);
  switch(typeString) {
    case "int": 
      type = "int";
      break;
    case "bool":
      type = "bool";
      break;
    case "none":
      type = "none";
      break;
    default: throw new Error(`Parser Error: Invalid type annotation: there is no class named: ${typeString}`)
  }
  t.nextSibling(); // focused on = sign.
  t.nextSibling(); // focused on the value expression

  var literal = traverseLiteral(t, s);
  t.parent();
  return { name, type, init: literal };
}

export function traverseFuncDef(s: string, t: TreeCursor) : FuncDef<null> {

  t.firstChild();  // Focus on def
  t.nextSibling(); // Focus on name of function
  var name = s.substring(t.from, t.to);
  t.nextSibling(); // Focus on ParamList
  var parameters = traverseParameters(s, t)
  t.nextSibling(); // Focus on Body or TypeDef
  let ret : Type = "none";
  let maybeTD = t;
  if(maybeTD.type.name === "TypeDef") {
    t.firstChild();
    ret = traverseType(s, t);
    t.parent();
  }
  t.nextSibling(); // Focus on single statement (for now)
  t.firstChild();  // Focus on :
  const body = [];
  const varInits = [];

  // parse var inits
  while(t.nextSibling()) {
    if (isVarDec(s, t)) {
      varInits.push(traverseVarInit(s, t));
    } else {
      break;
    }
  }

  // parse stmts
  // check if stmts don't exisit
  if (!isVarDec(s, t)) {
    // parse var stmts
    do {
      if (isVarDec(s, t)) {
        throw new Error('PARSE ERROR: Cannot have variable definition after statements')
      }
      body.push(traverseStmt(s, t));
    } while(t.nextSibling());
  }


  t.parent();      // Pop to Body
  t.parent();      // Pop to FunctionDefinition
  return { name, parameters, ret, inits: varInits, body: body }

}

/*
  Invariant – t must focus on the same node at the end of the traversal
*/
export function traverseStmt(s : string, t : TreeCursor) : Stmt<null> {
  switch(t.type.name) {

    case "ReturnStatement":
      t.firstChild();  // Focus return keyword
      t.nextSibling(); // Focus expression
      var value : Expr<null>;
      if (s.substring(t.from, t.to) !== '') {
        value = traverseExpr(s, t);
      } else {
        value = { tag: "literal", literal: { tag: "none"} }
      }
      t.parent();
      return { tag: "return", value };

    case "PassStatement":
      return { tag: "pass" };

    case "AssignStatement":
      t.firstChild(); // focused on name (the first child)
      var name = s.substring(t.from, t.to);
      t.nextSibling(); // focused on = sign or :. May need this for complex tasks, like +=!
      t.nextSibling(); // focused on the value expression

      var value = traverseExpr(s, t);
      t.parent();
      return  { tag: "assign", name, value };

    case "IfStatement":
      t.firstChild(); // focus on if
      t.nextSibling(); // focus on condition

      const condExpr = traverseExpr(s, t);
      const stmtBody:Array<Stmt<null>> = [];
      const elifStmts:Array<Elif<null>> = [];
      const elseBody:Array<Stmt<null>> = [];

      t.nextSibling(); // focus on body
      t.firstChild(); // focus on :

      while (t.nextSibling()) {
        stmtBody.push(traverseStmt(s, t));
      }

      t.parent(); // focus on if body

      while (t.nextSibling()) { // focus on else or elif
        const conditionType = s.substring(t.from, t.to);
        if (conditionType === "elif") {
          t.nextSibling(); // focus on elif condition
          const elifCondExpr = traverseExpr(s, t);
          const elifBody:Array<Stmt<null>> = [];
          t.nextSibling(); // focus on body
          t.firstChild(); // focus on :
          while (t.nextSibling()) {
            elifBody.push(traverseStmt(s, t));
          }
          elifStmts.push({ tag: "elif", cond: elifCondExpr, body: elifBody})

        } else {
          t.nextSibling(); // focus on body
          t.firstChild(); // focus on else :
  
          while (t.nextSibling()) {
            elseBody.push(traverseStmt(s, t));
          }
        }
        
  
        t.parent(); // focus on body
      }

      
      t.parent();
      return { tag: "if", cond: condExpr, body: stmtBody, elifs: elifStmts, elsebody: elseBody}


    case "WhileStatement":
      t.firstChild(); // focus while
      t.nextSibling(); // focus on while condition

      const whileCond = traverseExpr(s,t);
      const whileBody:Array<Stmt<null>> = [];

      t.nextSibling(); // focus on while body
      t.firstChild();  // Focus on :

      while(t.nextSibling()) {
        whileBody.push(traverseStmt(s, t));
      }
      t.parent();
      t.parent();
      return {tag: "while", cond: whileCond, body: whileBody}

    case "ExpressionStatement":
      t.firstChild(); // The child is some kind of expression, the
                      // ExpressionStatement is just a wrapper with no information
      var expr = traverseExpr(s, t);
      t.parent();
      return { tag: "expr", expr: expr };
      
  }
}

export function traverseType(s : string, t : TreeCursor) : Type {
  switch(t.type.name) {
    case "VariableName":
      const name = s.substring(t.from, t.to);
      if(name !== "int" && name !== "bool" && name!== "none" ) {
        throw new Error("Unknown type: " + name)
      }
      return name;
    default:
      throw new Error("Unknown type: " + t.type.name)

  }
}

export function traverseParameters(s : string, t : TreeCursor) : Array<Parameter<null>> {
  t.firstChild();  // Focuses on open paren
  const parameters = []
  t.nextSibling(); // Focuses on a VariableName
  while(t.type.name !== ")") {
    let name = s.substring(t.from, t.to);
    t.nextSibling(); // Focuses on "TypeDef", hopefully, or "," if mistake
    let nextTagName = t.type.name; // NOTE(joe): a bit of a hack so the next line doesn't if-split
    if(nextTagName !== "TypeDef") { throw new Error("Missed type annotation for parameter " + name)};
    t.firstChild();  // Enter TypeDef
    t.nextSibling(); // Focuses on type itself
    let typ = traverseType(s, t);
    t.parent();
    t.nextSibling(); // Move on to comma or ")"
    parameters.push({name, typ});
    t.nextSibling(); // Focuses on a VariableName
  }
  t.parent();       // Pop to ParamList
  return parameters;
}

export function traverseExpr(s : string, t : TreeCursor) : Expr<null> {
  switch(t.type.name) {
    case "Number":
      return { tag: "literal", literal: traverseLiteral(t, s) }
    case "Boolean":
      return { tag: "literal", literal: traverseLiteral(t, s) }
    case "None":
      return { tag: "literal", literal: traverseLiteral(t, s) }
    case "VariableName":
      return { tag: "id", name: s.substring(t.from, t.to) };
    case "CallExpression":
      t.firstChild(); // Focus name
      var name = s.substring(t.from, t.to);
      t.nextSibling(); // Focus ArgList
      t.firstChild(); // Focus open paren
      var args = traverseArguments(t, s);

      if (name === "max" || name === "min" || name === "abs" || name === "pow" || name === "print" ) {
        if (args.length == 1) {
          if (name !== "print" && name !== "abs"){
            throw new Error("ParseError: unknown buildin1")
          }
          t.parent(); // pop arglist & pop CallExpression
          return {
            tag: "call",
            name: name,
            arguments: [args[0]]
          };
        } else if (args.length == 2) {
          if (name !== "max" && name !== "min" && name !== "pow"){
            throw new Error("ParseError: unknown buildin2")
          }
          t.parent(); // pop arglist & pop CallExpression
          return {
            tag: "call",
            name: name,
            arguments: args
          };
        }
      }

      var result : Expr<null> = { tag: "call", name, arguments: args};
      t.parent();
      return result;

    case "ParenthesizedExpression":
      t.firstChild();
      t.nextSibling();
      const expr = traverseExpr(s, t);
      t.parent();
      
      return expr;

    case "UnaryExpression":
      t.firstChild();
      var uniOp : UniOp;

      switch(s.substring(t.from, t.to)) {
        case "not": 
          uniOp = UniOp.Not;
          break;
        case "-":
          uniOp = UniOp.Minus;
          break;
        default:
          throw new Error(`Unknown unary operation ${uniOp}`)
      }

      t.nextSibling();
      const uniArg = traverseExpr(s, t);

      t.parent();
      
      return { tag: "uniop", op: uniOp, arg: uniArg};
      
      
    case "BinaryExpression":
      t.firstChild();
      const left = traverseExpr(s, t);
      t.nextSibling();
      var op : BinOp;
      switch(s.substring(t.from, t.to)) {
        case "+":
          op = BinOp.Plus;
          break;
        case "-":
          op = BinOp.Minus;
          break;
        case "*":
          op = BinOp.Mul;
          break;
        case "//":
          op = BinOp.Div;
          break;
        case "%":
          op = BinOp.Rem;
          break;
        case "==":
          op = BinOp.Eq;
          break;
        case "!=":
          op = BinOp.Neq;
          break;
        case ">=":
          op = BinOp.Gte;
          break;
        case "<=":
          op = BinOp.Lte;
          break;
        case ">":
          op = BinOp.Gt;
          break;
        case "<":
          op = BinOp.Lt;
          break;
        case "is":
          op = BinOp.Is;
          break;
        default:
          throw new Error("ParseError: unknown binary operator")
      }
      t.nextSibling();
      const right = traverseExpr(s, t);
      t.parent(); // pop BinaryOperation
      return { tag: "binop", op: op, arg1: left, arg2: right }
  }
}

export function traverseLiteral(t: TreeCursor, s: string): Literal<null> {
  switch(t.type.name) {
    case "Number":
      return { tag: "number", value: Number(s.substring(t.from, t.to)) };
    case "Boolean":
      if (s.substring(t.from, t.to) === 'True') {
        return { tag: "true", value: true};
      } else {
        return { tag: "false", value: false}
      }
    case "None":
      return { tag: "none" }
    default:
      throw new Error(`Parse Error: unknown literal`)
  }
}

export function traverseArguments(c : TreeCursor, s : string) : Expr<null>[] {
  c.firstChild();  // Focuses on open paren
  const args = [];
  c.nextSibling();
  while(c.type.name !== ")") {
    let expr = traverseExpr(s, c);
    args.push(expr);
    c.nextSibling(); // Focuses on either "," or ")"
    c.nextSibling(); // Focuses on a VariableName
  } 
  c.parent();       // Pop to ArgList
  return args;
}