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

function someNode(node, visitorKeys, predicate) {
  if (predicate(node)) return true;
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    const children = Array.isArray(child) ? child : [child];
    for (const item of children) {
      if (
        item !== null &&
        typeof item === "object" &&
        typeof item.type === "string" &&
        someNode(item, visitorKeys, predicate)
      ) {
        return true;
      }
    }
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
    let effectDepth = 0;

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

    function setsStateIn(nodes) {
      return nodes.some((node) => someNode(node, visitorKeys, isSetterCall));
    }

    function awaitedThenSets(awaited) {
      const scope = nearestFunction(awaited);
      if (!scope) return false;
      const after = awaited.range[1];
      return someNode(
        scope.body,
        visitorKeys,
        (node) => isSetterCall(node) && node.range[0] >= after,
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
          effectDepth += 1;
          return;
        }
        if (effectDepth === 0) return;
        const name = ipcName(node);
        if (name === undefined) return;

        const { top, callbacks } = chainOf(node);
        const chained = top !== node;
        const awaited = top.parent?.type === "AwaitExpression" ? top.parent : undefined;
        if (chained && setsStateIn(callbacks)) {
          context.report({
            node,
            messageId: "rawIpcInEffect",
            data: { style: ".then 链调用", name },
          });
        } else if (awaited && awaitedThenSets(awaited)) {
          context.report({
            node,
            messageId: "rawIpcInEffect",
            data: { style: "await", name },
          });
        }
      },
      "CallExpression:exit"(node) {
        if (isEffectCall(node)) effectDepth -= 1;
      },
    };
  },
};
