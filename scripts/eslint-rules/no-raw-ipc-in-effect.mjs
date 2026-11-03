// userhome/no-raw-ipc-in-effect
//
// A page that reads the backend from inside an effect and then sets state has
// bound the answer to nothing: a newer read, a changed selection or an unmount
// can all let the old answer land. The answer must go through useLatestRequest.
//
// Reported: inside a useEffect / useLayoutEffect callback (nested functions
// included), a call to a function imported from an `ipc/<module>` file that is
// either awaited and followed by a state setter, or chained with
// .then/.catch/.finally whose callbacks call one. A state setter is `setX(...)`
// or `dispatch(...)`.
//
// Not reported, by design: an ipc promise that is first stored in a variable,
// a callback passed by name, and any read made outside an effect body. The rule
// is a net for the common shape, not a proof.
//
// Also not reported: the standard cleanup flag. The effect body declares
// `let active = true` (or `= false`), its returned cleanup function is the only
// place that assigns it, and it assigns the opposite literal; every state
// setter that follows the ipc call is then guarded by the flag, in an `if`
// (or `&&` / `?:`) around the setter, or an `if (!active) return;` before it
// in the same block. The guard must come after the ipc call. One setter left
// unguarded, a flag that is also assigned anywhere else (or declared outside
// the effect, or not reset by the cleanup) puts the report back.

const IPC_SOURCE = /(^|\/)ipc\/[^/]+$/;
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);
const CHAIN_METHODS = new Set(["then", "catch", "finally"]);
const SETTER_NAME = /^set[A-Z]/;

function isFunction(node) {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

function isEffectCall(node) {
  const { callee } = node;
  const name =
    callee.type === "Identifier"
      ? callee.name
      : callee.type === "MemberExpression" && !callee.computed
        ? callee.property.name
        : undefined;
  return (
    EFFECT_HOOKS.has(name) &&
    node.arguments.length > 0 &&
    isFunction(node.arguments[0])
  );
}

function isSetterCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    (SETTER_NAME.test(node.callee.name) || node.callee.name === "dispatch")
  );
}

function collectNodes(node, visitorKeys, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    const children = Array.isArray(child) ? child : [child];
    for (const item of children) {
      if (
        item !== null &&
        typeof item === "object" &&
        typeof item.type === "string"
      ) {
        collectNodes(item, visitorKeys, predicate, found);
      }
    }
  }
  return found;
}

function isBooleanLiteral(node) {
  return node?.type === "Literal" && typeof node.value === "boolean";
}

function within(inner, outer) {
  return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

/**
 * The effect's standard cleanup flags: `let x = <bool>` declared in the effect
 * body whose only assignments sit in the returned cleanup function and set the
 * opposite literal. `alive` is the value the flag has while the effect is live.
 */
function cleanupFlags(effect, visitorKeys) {
  if (effect.body.type !== "BlockStatement") return [];
  const statements = effect.body.body;
  const cleanups = statements
    .filter((statement) => statement.type === "ReturnStatement")
    .map((statement) => statement.argument)
    .filter((argument) => argument && isFunction(argument));
  const flags = [];
  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration" || statement.kind !== "let") {
      continue;
    }
    for (const declarator of statement.declarations) {
      if (declarator.id.type !== "Identifier" || !isBooleanLiteral(declarator.init)) {
        continue;
      }
      const name = declarator.id.name;
      const alive = declarator.init.value;
      const writes = collectNodes(
        effect.body,
        visitorKeys,
        (node) =>
          (node.type === "AssignmentExpression" &&
            node.left.type === "Identifier" &&
            node.left.name === name) ||
          (node.type === "UpdateExpression" &&
            node.argument.type === "Identifier" &&
            node.argument.name === name),
      );
      const onlyResetInCleanup =
        writes.length > 0 &&
        writes.every(
          (write) =>
            write.type === "AssignmentExpression" &&
            write.operator === "=" &&
            isBooleanLiteral(write.right) &&
            write.right.value === !alive &&
            cleanups.some((cleanup) => within(write, cleanup)),
        );
      if (onlyResetInCleanup) flags.push({ name, alive });
    }
  }
  return flags;
}

/** True when `test` evaluating to `outcome` means the effect is still live. */
function impliesAlive(test, outcome, flag) {
  switch (test.type) {
    case "Identifier":
      return test.name === flag.name && outcome === flag.alive;
    case "UnaryExpression":
      return test.operator === "!" && impliesAlive(test.argument, !outcome, flag);
    case "LogicalExpression":
      if (test.operator === "&&" && outcome) {
        return impliesAlive(test.left, true, flag) || impliesAlive(test.right, true, flag);
      }
      if (test.operator === "||" && !outcome) {
        return impliesAlive(test.left, false, flag) || impliesAlive(test.right, false, flag);
      }
      return false;
    default:
      return false;
  }
}

function exits(node) {
  if (node.type === "ReturnStatement") return true;
  return (
    node.type === "BlockStatement" &&
    node.body.length > 0 &&
    exits(node.body[node.body.length - 1])
  );
}

/**
 * Whether `setter` only runs while `flag` says the effect is live. Walks up to
 * the effect body; a guard whose test sits before `after` (the ipc call) does
 * not count, since the flag may change while the call is in flight.
 */
function guardedBy(setter, flag, effect, after) {
  let child = setter;
  for (let parent = setter.parent; parent && parent !== effect; parent = parent.parent) {
    if (parent.type === "IfStatement" || parent.type === "ConditionalExpression") {
      if (
        parent.test.range[0] >= after &&
        ((child === parent.consequent && impliesAlive(parent.test, true, flag)) ||
          (child === parent.alternate && impliesAlive(parent.test, false, flag)))
      ) {
        return true;
      }
    } else if (parent.type === "LogicalExpression" && parent.right === child) {
      if (
        parent.left.range[0] >= after &&
        ((parent.operator === "&&" && impliesAlive(parent.left, true, flag)) ||
          (parent.operator === "||" && impliesAlive(parent.left, false, flag)))
      ) {
        return true;
      }
    } else if (parent.type === "BlockStatement") {
      for (const statement of parent.body) {
        if (statement === child) break;
        if (
          statement.type === "IfStatement" &&
          statement.alternate === null &&
          exits(statement.consequent) &&
          statement.test.range[0] >= after &&
          impliesAlive(statement.test, false, flag)
        ) {
          return true;
        }
      }
    }
    child = parent;
  }
  return false;
}

function nearestFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current)) return current;
  }
  return undefined;
}

/** The outermost expression of `call().then(...).catch(...)`, with the chain's callbacks. */
function chainOf(call) {
  const callbacks = [];
  let top = call;
  for (;;) {
    const member = top.parent;
    const next = member?.parent;
    if (
      member?.type === "MemberExpression" &&
      member.object === top &&
      !member.computed &&
      CHAIN_METHODS.has(member.property.name) &&
      next?.type === "CallExpression" &&
      next.callee === member
    ) {
      callbacks.push(...next.arguments);
      top = next;
    } else {
      return { top, callbacks };
    }
  }
}

/** @type {import("eslint").Rule.RuleModule} */
export const noRawIpcInEffect = {
  meta: {
    type: "problem",
    docs: {
      description:
        "ipc 调用的结果在 useEffect 内直接 await 或 then 后设置状态，请改用 useLatestRequest",
    },
    schema: [],
    messages: {
      rawIpcInEffect:
        "useEffect 内直接 {{style}} ipc 函数 {{name}} 后设置状态，结果没有绑定到请求，旧请求晚到会覆盖新状态；请改用 useLatestRequest。",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const { visitorKeys } = sourceCode;
    const functions = new Set();
    const namespaces = new Set();
    const effects = [];

    function ipcName(call) {
      const { callee } = call;
      if (callee.type === "Identifier" && functions.has(callee.name)) {
        return callee.name;
      }
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        namespaces.has(callee.object.name)
      ) {
        return `${callee.object.name}.${callee.property.name}`;
      }
      return undefined;
    }

    function settersIn(nodes) {
      return nodes.flatMap((node) => collectNodes(node, visitorKeys, isSetterCall));
    }

    function settersAfter(awaited) {
      const scope = nearestFunction(awaited);
      if (!scope) return [];
      const after = awaited.range[1];
      return collectNodes(
        scope.body,
        visitorKeys,
        (node) => isSetterCall(node) && node.range[0] >= after,
      );
    }

    function unguarded(setters, effect, after) {
      const flags = cleanupFlags(effect, visitorKeys);
      return setters.filter(
        (setter) => !flags.some((flag) => guardedBy(setter, flag, effect, after)),
      );
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !IPC_SOURCE.test(node.source.value)) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.importKind === "type") continue;
          if (specifier.type === "ImportNamespaceSpecifier") {
            namespaces.add(specifier.local.name);
          } else {
            functions.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        if (isEffectCall(node)) {
          effects.push(node.arguments[0]);
          return;
        }
        if (effects.length === 0) return;
        const name = ipcName(node);
        if (name === undefined) return;

        const effect = effects[effects.length - 1];
        const { top, callbacks } = chainOf(node);
        const chained = top !== node;
        const awaited = top.parent?.type === "AwaitExpression" ? top.parent : undefined;
        const chainSetters = chained ? settersIn(callbacks) : [];
        if (chainSetters.length > 0) {
          if (unguarded(chainSetters, effect, node.range[1]).length > 0) {
            context.report({
              node,
              messageId: "rawIpcInEffect",
              data: { style: ".then 链调用", name },
            });
          }
        } else if (awaited) {
          const setters = settersAfter(awaited);
          if (unguarded(setters, effect, awaited.range[1]).length > 0) {
            context.report({
              node,
              messageId: "rawIpcInEffect",
              data: { style: "await", name },
            });
          }
        }
      },
      "CallExpression:exit"(node) {
        if (isEffectCall(node)) effects.pop();
      },
    };
  },
};
