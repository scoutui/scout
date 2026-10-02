export function Table({ children }: { children?: React.ReactNode }) {
  return <table>{children}</table>;
}

function Row() {
  return <tr />;
}

function Cell() {
  return <td />;
}

Table.Row = Row;
Table.Cell = Cell;
