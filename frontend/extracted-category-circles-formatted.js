lick: ()=>{
                                                                    const el = document.getElementById('nexus-catalog');
                                                                    if (el) {
                                                                        el.scrollIntoView({
                                                                            behavior: 'smooth'
                                                                        });
                                                                    }
                                                                    window.dispatchEvent(new CustomEvent('change-nexus-category', {
                                                                        detail: item.label
                                                                    }));
                                                                },
                                                                className: "flex flex-col items-center gap-2 shrink-0 group focus:outline-none",
                                                                children: [
                                                                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("div", {
                                                                        className: "w-16 h-16 rounded-full overflow-hidden border-2 border-white/5 group-hover:border-primary-yellow/60 transition-all duration-300 relative shadow-md",
                                                                        children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(_components_SafeImage__WEBPACK_IMPORTED_MODULE_8__["default"], {
                                                                            src: item.img,
                                                                            alt: item.label,
                                                                            fill: true,
                                                                            className: "object-cover group-hover:scale-110 transition-transform duration-500"
                                                                        }, void 0, false, {
                                                                            fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                                            lineNumber: 817,
                                                                            columnNumber: 23
                                                                        }, this)
                                                                    }, void 0, false, {
                                                                        fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                                        lineNumber: 816,
                                                                        columnNumber: 21
                                                                    }, this),
                                                                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("span", {
                                                                        className: "text-[10px] font-black text-white/60 group-hover:text-primary-yellow uppercase tracking-widest transition-colors",
                                                                        children: item.label
                                                                    }, void 0, false, {
                                                          