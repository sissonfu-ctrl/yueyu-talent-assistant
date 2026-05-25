//#region node_modules/tailwindcss-intersect/dist/index.esm.js
function g(n, i) {
	return {
		handler: n,
		config: i
	};
}
g.withOptions = function(n, i = () => ({})) {
	function t(o) {
		return {
			handler: n(o),
			config: i(o)
		};
	}
	return t.__isOptionsFunction = true, t;
};
var u = g;
var observer_default = {
	start() {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", () => this.observe());
			return;
		}
		this.observe();
	},
	restart() {
		this._observers.forEach((observer) => observer.disconnect());
		this._observers = [];
		this.observe();
	},
	observe() {
		document.querySelectorAll([
			"[class*=\" intersect:\"]",
			"[class*=\":intersect:\"]",
			"[class^=\"intersect:\"]",
			"[class=\"intersect\"]",
			"[class*=\" intersect \"]",
			"[class^=\"intersect \"]",
			"[class$=\" intersect\"]"
		].join(",")).forEach((element) => {
			const observer = new IntersectionObserver((entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) {
						element.setAttribute("no-intersect", "");
						return;
					}
					element.removeAttribute("no-intersect");
					element.classList.contains("intersect-once") && observer.disconnect();
				});
			}, { threshold: this._getThreshold(element) });
			observer.observe(element);
			this._observers.push(observer);
		});
	},
	_getThreshold(element) {
		if (element.classList.contains("intersect-full")) return .99;
		if (element.classList.contains("intersect-half")) return .5;
		return 0;
	},
	_observers: []
};
var index_default = u(({ addVariant }) => {
	addVariant("intersect", "&:not([no-intersect])");
});

//#endregion
export { observer_default as Observer, index_default as default };
//# sourceMappingURL=tailwindcss-intersect.js.map