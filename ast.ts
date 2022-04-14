export type Program<A> = { a?: A, varinits: Array<VarInit<A>>, fundefs: Array<FuncDef<A>>, stmts: Array<Stmt<A>> }

export type Type =
  | "int"
  | "bool"
  | "none"

export type Parameter<A> =
  | { a?: A, name: string, typ: Type }

export type Elif<A> = 
  | { a?: A, tag: "elif", cond: Expr<A>, body: Array<Stmt<A>>}

export type VarInit<A> = { a?: A, name: string, type: Type, init: Literal<A> }

export type FuncDef<A> = { a?: A, name: string, parameters: Array<Parameter<A>>, ret: Type, inits: Array<VarInit<A>>, body: Array<Stmt<A>> }

export type Stmt<A> =
  | { a?: A, tag: "expr", expr: Expr<A>}
  | { a?: A, tag: "assign", name: string, value: Expr<A> }
  | { a?: A, tag: "expr", expr: Expr<A> }
  | { a?: A, tag: "return", value: Expr<A> }
  | { a?: A, tag: "if", cond: Expr<A>, body: Array<Stmt<A>>, elifs: Array<Elif<A>>, elsebody: Array<Stmt<A>>} 
  | { a?: A, tag: "while", cond: Expr<A>, body: Array<Stmt<A>>}
  | { a?: A, tag: "pass" }

export type Expr<A> = 
  | { a?: A, tag: "literal", literal: Literal<A> }
  | { a?: A, tag: "id", name: string }
  | { a?: A, tag: "call", name: string, arguments: Array<Expr<A>> }
  | { a?: A, tag: "binop", op: BinOp, arg1: Expr<A>, arg2: Expr<A>}
  | { a?: A, tag: "uniop", op: UniOp, arg: Expr<A> }

export type Literal<A> = 
  | { a?: A, tag: "number", value: number }
  | { a?: A, tag: "true", value: boolean }
  | { a?: A, tag: "false", value: boolean }
  | { a?: A, tag: "none" }

export enum BinOp { Plus = "+", Minus = "-", Mul = "*" , Div = "//", Rem = "%", 
  Eq = "==", Neq = "!=" , Gte = ">=", Lte = "<=", Gt = ">", Lt = "<" , Is = "is"}

export enum UniOp { Not = "not", Minus = "-" }