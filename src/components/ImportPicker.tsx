import { createContext, useContext, type ReactNode } from "react";
export const ImportPickerContext = createContext<() => void>(() => {});
export function ImportButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const open = useContext(ImportPickerContext);
  return (
    <button className={className} onClick={open}>
      {children}
    </button>
  );
}
