import { r as __toESM } from "./chunk-D94lAOSK.js";
import { t as require_react } from "./react-CT_z9WBP.js";

//#region node_modules/@radix-ui/react-use-previous/dist/index.mjs
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
function usePrevious(value) {
	const ref = import_react.useRef({
		value,
		previous: value
	});
	return import_react.useMemo(() => {
		if (ref.current.value !== value) {
			ref.current.previous = ref.current.value;
			ref.current.value = value;
		}
		return ref.current.previous;
	}, [value]);
}

//#endregion
export { usePrevious as t };
//# sourceMappingURL=dist-CbgD3Jjs.js.map