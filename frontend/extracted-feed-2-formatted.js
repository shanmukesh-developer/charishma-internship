restaurant-feed",
                                                className: "pb-20 scroll-mt-24",
                                                children: [
                                                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("h2", {
                                                        className: "text-[9px] font-black uppercase tracking-[0.2em] text-secondary-text mb-4",
                                                        children: "Recommendations for you in Kuragallu"
                                                    }, void 0, false, {
                                                        fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                        lineNumber: 1484,
                                                        columnNumber: 13
                                                    }, this),
                                                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("div", {
                                                        className: "grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6",
                                                        children: [
                                                            ...displayRestaurants
                                                        ].sort((a, b)=>(b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0)).map((res, index)=>/*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("div", {
                                                                className: "animate-slide-up",
                                                                style: {
                                                                    animationDelay: "".concat(index * 0.05, "s"),
                                                                    animationFillMode: 'both'
                                                                },
                                                                children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)((next_link__WEBPACK_IMPORTED_MODULE_6___default()), {
                                                                    href: "/restaurants/".concat(res._id || res.id),
                                                                    prefetch: false,
                                                                    children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(_components_RestaurantCard__WEBPACK_IMPORTED_MODULE_7__["default"], {
                                                                        name: res.name,
                                                                        rating: String(res.rating || "4.5"),
                                                                        time: res.calculatedTime || res.time || "30-50 min",
                                                                        imageUrl: res.imageUrl || "/assets/placeholder_premium.png",
                                                                        imagePosition: index % 2 === 0 ? 'left' : 'right',
                                                                        isFeatured: res.isFeatured,
                                                                        featuredBadge: res.featuredBadge,
                                                                        canteenType: res.canteenType
                                                                    }, void 0, false, {
                                                                        fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                                        lineNumber: 1491,
                                                                        columnNumber: 21
                                                                    }, this)
                                                                }, void 0, false, {
                                                                    fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                                    lineNumber: 1490,
                                                                    columnNumber: 19
                                                                }, this)
                                                            }, res._id || res.id, false, {
                                                                fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                                lineNumber: 1489,
                                                                columnNumber: 17
                                                            }, this))
                                                    }, void 0, false, {
                                                        fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                        lineNumber: 1485,
                                                        columnNumber: 13
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                lineNumber: 1483,
                                                columnNumber: 11
                                            }, this),
                                            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("div", {
                                                className: "mb-20",
                                                children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(CampusBitesSection, {
                                                    restaurants: liveRestaurants
                                                }, void 0, false, {
                                                    fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                    lineNumber: 1509,
                                                    columnNumber: 13
                                                }, this)
                                            }, void 0, false, {
                                                fileName: "C:\\\\hostel-bite\\\\frontend\\\\src\\\\app\\\\page.tsx",
                                                lineNumber: 1508,
                                                columnNumber: 11
                                            }, this),
                                            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)("footer", {
                                                className: "fixed bottom-0 left-0 right-0 h-[5.5rem] bg-black/90 backdrop-blur-3xl border-t border-white/10 flex items-center justify-around sm:hidden z-[100] pb-safe light:bg-white/95 light:border-black/10",
                                                children: [
                                                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(_components_Magnetic__WEBPACK_IMPORTED_MODULE_12__["default"], {
                                                        children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)((next_link__WEBPACK_IMPORTED_MODULE_6___default()), {
                                                            href: