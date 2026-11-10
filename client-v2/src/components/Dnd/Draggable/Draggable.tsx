import {
  UniqueIdentifier,
  useDraggable,
  UseDraggableArguments,
} from "@dnd-kit/core";
import { ForwardRefExoticComponent, KeyboardEvent } from "react";

interface DraggableProps<P> {
  Item: ForwardRefExoticComponent<P>;
  itemProps: P;
  id: UniqueIdentifier;
}

const Draggable = <P,>({ Item, itemProps, id }: DraggableProps<P>) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: itemProps as UseDraggableArguments["data"],
  });

  return (
    <Item
      ref={setNodeRef}
      style={{ cursor: isDragging ? "grabbing" : "pointer" }}
      {...listeners}
      {...attributes}
      // The item is a `role="button"` in the Tab order (dnd-kit's
      // attributes), so Enter and Space press it as they would a button. Only
      // the mouse drags (`Dnd.Context` registers no keyboard sensor), so no
      // drag key is taken from it.
      onKeyDown={(ev: KeyboardEvent<HTMLElement>) => {
        if (ev.target !== ev.currentTarget) return;
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.currentTarget.click();
      }}
      {...itemProps}
    />
  );
};

export default Draggable;
