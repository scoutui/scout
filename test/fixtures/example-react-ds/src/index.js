// A React design-system package with no custom-elements manifest: every
// identity comes from the import.
function Button(_props) {
  return null;
}

function TextInput(_props) {
  return null;
}

function Card(_props) {
  return null;
}

function RadioArea(_props) {
  return null;
}

function Root(_props) {
  return null;
}

function Leaf(_props) {
  return null;
}

function Banner(_props) {
  return null;
}

// A compound export: a plain object whose members are components, the shape
// several React libraries ship (`<Toast.Title/>`). Consumed by
// react-shapes/src/react-engine-shapes/Compound.tsx and
// react-shapes/src/deep-compound/Menus.tsx.
var Toast = {
  Title: function Title(_props) {
    return null;
  },
  Description: function Description(_props) {
    return null;
  },
};

// A second compound export (`<Tabs.Root/>`). Consumed by
// react-shapes/src/compound-roots/App.tsx.
var Tabs = {
  Root: function Root(_props) {
    return null;
  },
  Trigger: function Trigger(_props) {
    return null;
  },
};

// A plain data export, so a consumer can `.map` over an array that came from
// this package rather than from a local literal.
var items = ["a", "b"];

// A hook that takes a component and returns a rendered element plus a
// controller. Consumed by
// react-shapes/src/react-engine-shapes/HookSeeding.tsx.
function useModalHolder(_Component) {
  return [null, function show() {}];
}

module.exports = {
  Button: Button,
  TextInput: TextInput,
  Card: Card,
  RadioArea: RadioArea,
  Root: Root,
  Leaf: Leaf,
  Banner: Banner,
  Toast: Toast,
  Tabs: Tabs,
  items: items,
  useModalHolder: useModalHolder,
};
