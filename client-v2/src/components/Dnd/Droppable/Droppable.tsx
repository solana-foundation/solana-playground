import { UniqueIdentifier, useDroppable } from "@dnd-kit/core";
import { CSSProperties, FC, useEffect } from "react";

interface DroppableProps {
  id: UniqueIdentifier;
  overStyle?: CSSProperties;
  onDragOver?: (ref: HTMLElement) => void;
}

const Droppable: FC<React.PropsWithChildren<DroppableProps>> = ({
  id,
  overStyle,
  onDragOver,
  children,
}) => {
  const { isOver, node, setNodeRef } = useDroppable({ id });

  useEffect(() => {
    if (isOver && node.current) onDragOver?.(node.current);
  }, [isOver, node, onDragOver]);

  return (
    <div ref={setNodeRef} style={isOver ? overStyle : undefined}>
      {children}
    </div>
  );
};

export default Droppable;
