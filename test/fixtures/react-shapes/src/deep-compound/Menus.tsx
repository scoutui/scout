import * as Kit from "@example/react-ds";

// A compound member two levels deep, through a namespace import and through
// a local object literal.
const Nav = { Menu: { Item: () => <li /> } };

export function Menus() {
  return (
    <>
      <Kit.Toast.Title />
      <Nav.Menu.Item />
    </>
  );
}
