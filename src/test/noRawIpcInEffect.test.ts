import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { noRawIpcInEffect } from "../../scripts/eslint-rules/no-raw-ipc-in-effect.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  // The TypeScript parser, so `import type` parses like it does in src/.
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parser: tseslint.parser,
  },
});

const IMPORT = `import { listThings, getThing } from "../../ipc/things";`;

tester.run("userhome/no-raw-ipc-in-effect", noRawIpcInEffect, {
  valid: [
    {
      name: "the read goes through useLatestRequest",
      code: `${IMPORT}
        useEffect(() => {
          latest.run(listThings, { onResult: (items) => setItems(items) });
        }, []);`,
    },
    {
      name: "an ipc call whose answer sets no state",
      code: `${IMPORT}
        useEffect(() => {
          void listThings().then((items) => console.log(items));
        }, []);`,
    },
    {
      name: "an awaited ipc call with no state set after it",
      code: `${IMPORT}
        useEffect(() => {
          (async () => {
            await listThings();
            notify();
          })();
        }, []);`,
    },
    {
      name: "a state set that comes before the await",
      code: `${IMPORT}
        useEffect(() => {
          (async () => {
            setLoading(true);
            await listThings();
          })();
        }, []);`,
    },
    {
      name: "an ipc call outside any effect",
      code: `${IMPORT}
        function refresh() {
          listThings().then((items) => setItems(items));
        }`,
    },
    {
      name: "a function that is not from an ipc module",
      code: `import { listThings } from "../model/things";
        useEffect(() => {
          listThings().then((items) => setItems(items));
        }, []);`,
    },
    {
      name: "a type-only import from ipc",
      code: `import type { listThings } from "../../ipc/things";
        useEffect(() => {
          listThings().then((items) => setItems(items));
        }, []);`,
    },
    {
      name: "a state set in an effect that calls no ipc function",
      code: `${IMPORT}
        useEffect(() => {
          const items = decode(raw);
          setItems(items);
        }, []);`,
    },
  ],
  invalid: [
    {
      name: "then chain that sets state",
      code: `${IMPORT}
        useEffect(() => {
          listThings().then((items) => setItems(items));
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect", line: 3 }],
    },
    {
      name: "then chain whose catch sets state",
      code: `${IMPORT}
        useEffect(() => {
          void listThings().then(log).catch(() => setFailed(true));
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "dispatch counts as setting state",
      code: `${IMPORT}
        useEffect(() => {
          listThings().then((items) => dispatch({ type: "loaded", items }));
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "await in an inner async function, then set state",
      code: `${IMPORT}
        useEffect(() => {
          async function load() {
            const items = await listThings();
            setItems(items);
          }
          void load();
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect", line: 4 }],
    },
    {
      name: "await in a try block, state set in the finally",
      code: `${IMPORT}
        useLayoutEffect(() => {
          (async () => {
            try {
              await getThing(id);
            } finally {
              setBusy(false);
            }
          })();
        }, [id]);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "namespace import",
      code: `import * as things from "./ipc/things";
        React.useEffect(() => {
          things.listThings().then((items) => setItems(items));
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "two reads, both reported",
      code: `${IMPORT}
        useEffect(() => {
          listThings().then((items) => setItems(items));
          getThing(1).then((thing) => setThing(thing));
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }, { messageId: "rawIpcInEffect" }],
    },
  ],
});
