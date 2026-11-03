// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderStrict } from "./renderStrict";

afterEach(cleanup);

function Probe({ log }: { log: string[] }) {
  useEffect(() => {
    log.push("mount");
    return () => {
      log.push("cleanup");
    };
  }, [log]);
  return <p>probe</p>;
}

describe("renderStrict", () => {
  it("mounts, cleans up and mounts again, as StrictMode does in development", () => {
    const log: string[] = [];
    renderStrict(<Probe log={log} />);
    expect(log).toEqual(["mount", "cleanup", "mount"]);
  });

  it("renders the element like Testing Library's render", () => {
    renderStrict(<Probe log={[]} />);
    expect(screen.getByText("probe")).toBeTruthy();
  });
});
