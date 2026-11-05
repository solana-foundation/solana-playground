import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import BaseNoFiles from "./BaseNoFiles";

const draw = () => {
  const onAddFile = vi.fn(async () => {});
  const onStartProject = vi.fn();
  render(<BaseNoFiles onAddFile={onAddFile} onStartProject={onStartProject} />);
  return { onAddFile, onStartProject };
};

it("says the project has no files and how to fill it", () => {
  draw();
  expect(
    screen.getByRole("heading", { name: "This project has no files" })
  ).toBeTruthy();
  expect(
    screen.getByText("Add a file to start, or start from a template.")
  ).toBeTruthy();
});

it("adds a file and starts a project from its two buttons", async () => {
  const { onAddFile, onStartProject } = draw();
  await userEvent.click(screen.getByRole("button", { name: "Add a file" }));
  expect(onAddFile).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Start a project" })
  );
  expect(onStartProject).toHaveBeenCalledTimes(1);
});
