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
    {
      name: "standard cleanup flag: then callback checks the flag before setting state",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then(
            (items) => {
              if (active) setItems(items);
            },
            () => {
              if (active) setFailed(true);
            },
          );
          return () => {
            active = false;
          };
        }, []);`,
    },
    {
      name: "standard cleanup flag: early return in the callback",
      code: `${IMPORT}
        useEffect(() => {
          let current = true;
          void listThings().then((items) => {
            if (!current) return;
            setItems(items);
          });
          return () => {
            current = false;
          };
        }, []);`,
    },
    {
      name: "standard cleanup flag: a flag that starts false and is set by the cleanup",
      code: `${IMPORT}
        useEffect(() => {
          let disposed = false;
          void listThings()
            .then((items) => {
              if (disposed) return;
              setItems(items);
            })
            .catch(() => {
              if (!disposed) setFailed(true);
            });
          return function cleanup() {
            disposed = true;
          };
        }, []);`,
    },
    {
      name: "standard cleanup flag: the flag is one conjunct of the guard",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          const id = tracker.issue();
          listThings().then((items) => {
            if (active && tracker.isCurrent(id)) setItems(items);
          });
          return () => {
            active = false;
          };
        }, []);`,
    },
    {
      name: "standard cleanup flag: guard written as && or a ternary",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => active && setItems(items));
          getThing(1).then((thing) => (active ? setThing(thing) : undefined));
          return () => {
            active = false;
          };
        }, []);`,
    },
    {
      name: "standard cleanup flag: await followed by a guard, then the setter",
      code: `${IMPORT}
        useEffect(() => {
          let cancelled = false;
          (async () => {
            try {
              const items = await listThings();
              if (cancelled) return;
              setItems(items);
            } catch {
              if (!cancelled) setFailed(true);
            }
          })();
          return () => {
            cancelled = true;
          };
        }, []);`,
    },
    {
      name: "standard cleanup flag: chained callbacks that set no state need no guard",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            if (active) setItems(items);
          }).finally(() => {
            if (active) schedule();
          });
          return () => {
            active = false;
          };
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
    {
      name: "a flag the cleanup never resets",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            if (active) setItems(items);
          });
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "a flag the cleanup sets to the same value it started with",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            if (active) setItems(items);
          });
          return () => {
            active = true;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "a flag that is also assigned outside the cleanup",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            active = true;
            if (active) setItems(items);
          });
          return () => {
            active = false;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "a flag declared outside the effect",
      code: `${IMPORT}
        let active = true;
        useEffect(() => {
          listThings().then((items) => {
            if (active) setItems(items);
          });
          return () => {
            active = false;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "the state is set before the flag is checked",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            setItems(items);
            if (!active) return;
            notify();
          });
          return () => {
            active = false;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "only the success callback checks the flag",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then(
            (items) => {
              if (active) setItems(items);
            },
            () => setFailed(true),
          );
          return () => {
            active = false;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "the setter sits in the branch where the flag says the effect is gone",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            if (!active) setItems(items);
          });
          return () => {
            active = false;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "the flag is checked before the await, not after it",
      code: `${IMPORT}
        useEffect(() => {
          let cancelled = false;
          (async () => {
            if (cancelled) return;
            const items = await listThings();
            setItems(items);
          })();
          return () => {
            cancelled = true;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
    {
      name: "the check looks at some other variable",
      code: `${IMPORT}
        useEffect(() => {
          let active = true;
          listThings().then((items) => {
            if (mounted) setItems(items);
          });
          return () => {
            active = false;
          };
        }, []);`,
      errors: [{ messageId: "rawIpcInEffect" }],
    },
  ],
});
