import { createContext } from "react";
import { Button, Card } from "@example/react-ds";

// A context whose default value is a component. Rendering the context, its
// Provider or its Consumer renders neither the context nor that default.
export const ThemeContext = createContext(Button);

export function ThemeProvider({ children }: any) {
  return <ThemeContext.Provider value={Card}>{children}</ThemeContext.Provider>;
}

// React 19 renders the context itself as its provider.
export function NextThemeProvider({ children }: any) {
  return <ThemeContext value={Card}>{children}</ThemeContext>;
}

export function ThemedIcon() {
  return <ThemeContext.Consumer>{(Theme: any) => <Theme />}</ThemeContext.Consumer>;
}

export function ThemedPage() {
  return (
    <ThemeProvider>
      <Card />
    </ThemeProvider>
  );
}
