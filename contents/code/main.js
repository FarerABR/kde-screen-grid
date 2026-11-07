/*
 * kde Screen Grid Sync
 * KWin 6.7+ / Plasma 6
 * Synchronizes independent per-screen virtual desktops using monitor geometry.
 * Reconstructed replacement for the previously shared experimental script.
 */

var TOL = 2; // px of slack when deciding that edges touch
var SAME_RATIO = 0.5; // overlap above this share of the smaller monitor = same row/column

function mod(a, n) {
	return ((a % n) + n) % n;
}

// ---- desktop grid (row-major, 1-based desktop numbers) ----
function numToCell(num, W) {
	return { row: Math.floor((num - 1) / W), col: (num - 1) % W };
}
function cellToNum(c, W) {
	return c.row * W + c.col + 1;
}
function cellFor(ref, d, W, H) {
	return { row: mod(ref.row + d.row, H), col: mod(ref.col + d.col, W) };
}
function refFrom(cell, d, W, H) {
	return { row: mod(cell.row - d.row, H), col: mod(cell.col - d.col, W) };
}

// offsets of every monitor relative to the reference monitor
function offsetsFrom(coords, reference) {
	var ref = coords[reference],
		out = {};
	for (var n in coords)
		out[n] = { row: coords[n].row - ref.row, col: coords[n].col - ref.col };
	return out;
}

// desktop number for every monitor, given the desktop one monitor shows
function desktopsFor(srcName, srcNum, offsets, W, H) {
	var ref = refFrom(numToCell(srcNum, W), offsets[srcName], W, H);
	var out = {};
	for (var n in offsets) out[n] = cellToNum(cellFor(ref, offsets[n], W, H), W);
	return out;
}

// ---- monitor layout inference ----
function span(m, axis) {
	return axis === "x" ? [m.x, m.x + m.width] : [m.y, m.y + m.height];
}
function overlap(a, b) {
	return Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
}

// Group monitors that share a row (axis "y") or column (axis "x").
function clusterAxis(mons, axis) {
	var n = mons.length,
		p = [],
		i,
		j;
	for (i = 0; i < n; i++) p.push(i);
	function find(x) {
		while (p[x] !== x) {
			p[x] = p[p[x]];
			x = p[x];
		}
		return x;
	}
	for (i = 0; i < n; i++)
		for (j = i + 1; j < n; j++) {
			var a = span(mons[i], axis),
				b = span(mons[j], axis);
			var ov = overlap(a, b);
			if (ov <= TOL) continue;
			if (ov / Math.min(a[1] - a[0], b[1] - b[0]) <= SAME_RATIO)
				return {
					error:
						mons[i].name +
						" and " +
						mons[j].name +
						" only partly overlap along " +
						axis +
						" (ambiguous)",
				};
			p[find(i)] = find(j);
		}
	var groups = {},
		roots = [];
	for (i = 0; i < n; i++) {
		var r = find(i);
		if (!groups[r]) {
			groups[r] = [];
			roots.push(r);
		}
		groups[r].push(i);
	}
	function start(g) {
		return Math.min.apply(
			null,
			g.map(function (k) {
				return span(mons[k], axis)[0];
			}),
		);
	}
	roots.sort(function (a, b) {
		return start(groups[a]) - start(groups[b]);
	});
	var index = [];
	roots.forEach(function (r, rank) {
		groups[r].forEach(function (k) {
			index[k] = rank;
		});
	});
	return { index: index };
}

// Two monitors are adjacent if they share an edge segment (corner contact does not count).
function adjacent(a, b) {
	var sx = overlap(span(a, "x"), span(b, "x")),
		sy = overlap(span(a, "y"), span(b, "y"));
	var touchX =
		Math.abs(a.x + a.width - b.x) <= TOL ||
		Math.abs(b.x + b.width - a.x) <= TOL;
	var touchY =
		Math.abs(a.y + a.height - b.y) <= TOL ||
		Math.abs(b.y + b.height - a.y) <= TOL;
	return (touchX && sy > TOL) || (touchY && sx > TOL);
}

// mons: [{name, x, y, width, height}] -> {coords: {name: {row, col}}} or {error}
function inferLayout(mons) {
	var cols = clusterAxis(mons, "x");
	if (cols.error) return { error: cols.error };
	var rows = clusterAxis(mons, "y");
	if (rows.error) return { error: rows.error };
	var coords = {},
		seen = {},
		i,
		k;
	for (i = 0; i < mons.length; i++) {
		var key = rows.index[i] + "," + cols.index[i];
		if (seen[key])
			return {
				error:
					seen[key] +
					" and " +
					mons[i].name +
					" land in the same cell (overlapping or mirrored)",
			};
		seen[key] = mons[i].name;
		coords[mons[i].name] = { row: rows.index[i], col: cols.index[i] };
	}
	var reached = [0],
		queue = [0];
	while (queue.length) {
		var cur = queue.pop();
		for (k = 0; k < mons.length; k++)
			if (reached.indexOf(k) < 0 && adjacent(mons[cur], mons[k])) {
				reached.push(k);
				queue.push(k);
			}
	}
	if (reached.length !== mons.length)
		return {
			error: "monitors are not all edge-connected (gap or corner-only contact)",
		};
	return { coords: coords };
}

// ---- validation: returns a list of error strings (empty = OK) ----
// cfg: {W, H, desktopCount, monitors: [{name}], coords: {name: {row, col}}, reference: name}
function validate(cfg) {
	var errs = [],
		W = cfg.W,
		H = cfg.H;
	function isInt(v) {
		return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
	}
	if (cfg.monitors.length < 2)
		errs.push("need at least 2 monitors, found " + cfg.monitors.length);
	if (!isInt(W) || !isInt(H) || W < 1 || H < 1)
		errs.push("invalid desktop grid " + W + "x" + H);
	else if (W * H !== cfg.desktopCount)
		errs.push(
			"grid " +
				W +
				"x" +
				H +
				" does not match " +
				cfg.desktopCount +
				" desktops",
		);
	cfg.monitors.forEach(function (m) {
		var c = cfg.coords[m.name];
		if (!c || !isInt(c.row) || !isInt(c.col) || c.row < 0 || c.col < 0)
			errs.push("no valid coordinate for " + m.name);
	});
	if (!cfg.coords[cfg.reference])
		errs.push("reference monitor '" + cfg.reference + "' not found");
	if (errs.length) return errs;

	var off = offsetsFrom(cfg.coords, cfg.reference),
		seen = {};
	cfg.monitors.forEach(function (m) {
		var key = mod(off[m.name].row, H) + "," + mod(off[m.name].col, W);
		if (seen[key])
			errs.push(
				seen[key] +
					" and " +
					m.name +
					" would show the same desktop (" +
					W +
					"x" +
					H +
					" grid is too small for this arrangement)",
			);
		else seen[key] = m.name;
	});
	return errs;
}

var DSG_CONFIG = {
	coordinates: null, // manual override, e.g. { "eDP-1": { row: 0, column: 0 }, "HDMI-A-1": { row: 0, column: 1 } }
	reference: null, // monitor the others follow at startup/reconfigure; null = top-left monitor
	logMoves: true, // log every window move
	debug: true, // log every desktop event and the desktops it produces
};

if (typeof DSG !== "undefined" && DSG && DSG.shutdown) {
	try {
		DSG.shutdown();
	} catch (e) {
		print("DSG: old instance shutdown failed: " + e);
	}
}

var DSG = (function () {
	var CFG = DSG_CONFIG;
	var S = {
		active: false,
		busy: false,
		reconfiguring: false,
		offsets: null,
		W: 0,
		H: 0,
		mons: [],
		ref: null,
		errors: [],
	};
	var watchers = [],
		outConns = [],
		syncConns = [],
		winConns = [];

	function log(m) {
		print("DSG: " + m);
	}
	function dbg(m) {
		if (CFG.debug) print("DSG: " + m);
	}

	function hook(list, obj, sigName, fn) {
		var sig = obj && obj[sigName];
		if (!sig || !sig.connect) return;
		sig.connect(fn);
		list.push({ sig: sig, fn: fn, obj: obj });
	}
	function unhookAll(list) {
		while (list.length) {
			var c = list.pop();
			try {
				c.sig.disconnect(c.fn);
			} catch (e) {}
		}
	}

	// ---- lookups ----
	function outputByName(name) {
		var s = workspace.screens;
		for (var i = 0; i < s.length; i++) if (s[i].name === name) return s[i];
		return null;
	}
	function desktopByNumber(n) {
		var d = workspace.desktops;
		for (var i = 0; i < d.length; i++)
			if (d[i].x11DesktopNumber === n) return d[i];
		return null;
	}
	function currentNum(out) {
		var d = out ? workspace.currentDesktopForScreen(out) : null;
		return d ? d.x11DesktopNumber : null;
	}
	// default reference = top-left monitor (smallest row, then smallest column)
	function pickReference(coords) {
		var best = null;
		for (var n in coords) {
			var c = coords[n];
			if (
				best === null ||
				c.row < coords[best].row ||
				(c.row === coords[best].row && c.col < coords[best].col)
			)
				best = n;
		}
		return best;
	}

	// ---- validate everything; returns {errors, ...} and never touches state ----
	function build() {
		var screens = workspace.screens,
			mons = [],
			errs = [],
			seenNames = {},
			i;
		for (i = 0; i < screens.length; i++) {
			var g = screens[i].geometry;
			mons.push({
				name: screens[i].name,
				x: g.x,
				y: g.y,
				width: g.width,
				height: g.height,
			});
			if (seenNames[screens[i].name])
				errs.push("duplicate monitor name " + screens[i].name);
			seenNames[screens[i].name] = true;
		}
		var W = workspace.desktopGridWidth,
			H = workspace.desktopGridHeight,
			N = workspace.desktops.length;
		var coords = {},
			ref = null;
		if (mons.length < 2)
			errs.push("need at least 2 monitors, found " + mons.length);
		else if (!errs.length) {
			var lay = inferLayout(mons);
			if (CFG.coordinates) {
				// manual override wins
				for (i = 0; i < mons.length; i++) {
					var c = CFG.coordinates[mons[i].name];
					if (c) coords[mons[i].name] = { row: c.row, col: c.column };
				}
				if (lay.coords)
					for (i = 0; i < mons.length; i++) {
						var a = coords[mons[i].name],
							b = lay.coords[mons[i].name];
						if (a && (a.row !== b.row || a.col !== b.col)) {
							log(
								"NOTE: configured coordinates differ from the detected layout (using configured)",
							);
							break;
						}
					}
			} else if (lay.error) errs.push(lay.error);
			else coords = lay.coords;
			ref = CFG.reference || pickReference(coords);
		}
		if (!errs.length)
			errs = validate({
				W: W,
				H: H,
				desktopCount: N,
				monitors: mons,
				coords: coords,
				reference: ref,
			});
		if (!errs.length) {
			for (i = 0; i < N; i++)
				if (workspace.desktops[i].x11DesktopNumber !== i + 1) {
					errs.push("desktop numbering is not 1..N in order");
					break;
				}
			for (i = 0; i < screens.length; i++) {
				var n = currentNum(screens[i]);
				if (n === null || n < 1 || n > N)
					errs.push("no valid current desktop for " + screens[i].name);
			}
		}
		return { errors: errs, mons: mons, coords: coords, ref: ref, W: W, H: H };
	}

	// ---- guarded execution: no re-entry, any error disables syncing ----
	function run(fn) {
		if (S.busy) return;
		S.busy = true;
		try {
			fn();
		} catch (e) {
			log("ERROR " + e + " -> disabling");
			S.errors = ["runtime error: " + e];
			S.busy = false;
			stop();
		} finally {
			S.busy = false;
		}
	}

	// ---- desktop synchronisation ----
	// srcNum comes from the event itself (KWin's own state may lag the signal).
	// Returns {outputName: desktopNumber} for every monitor.
	function syncFrom(srcName, srcNum) {
		var want = desktopsFor(srcName, srcNum, S.offsets, S.W, S.H);
		dbg("sync from " + srcName + "=" + srcNum + " -> " + JSON.stringify(want));
		for (var name in want) {
			if (name === srcName) continue;
			var o = outputByName(name),
				d = desktopByNumber(want[name]);
			if (!o || !d) throw new Error("missing output or desktop for " + name);
			if (currentNum(o) !== want[name])
				workspace.setCurrentDesktopForScreen(d, o);
		}
		return want;
	}

	// ---- window migration ----
	function mapFromWant(want) {
		// {desktopNumber: output}
		var m = {};
		for (var name in want) {
			var o = outputByName(name);
			if (o) m[want[name]] = o;
		}
		return m;
	}
	function liveMap() {
		var m = {};
		for (var i = 0; i < S.mons.length; i++) {
			var o = outputByName(S.mons[i].name),
				n = currentNum(o);
			if (o && n !== null) m[n] = o;
		}
		return m;
	}
	function eligible(w) {
		if (!w || w.deleted || w.managed === false) return false;
		if (
			!w.normalWindow ||
			w.dialog ||
			w.transient ||
			w.specialWindow ||
			w.desktopWindow ||
			w.popupWindow ||
			w.appletPopup
		)
			return false;
		if (w.onAllDesktops || w.move || w.resize) return false;
		return !!w.desktops && w.desktops.length === 1;
	}
	function place(w, vis) {
		if (!eligible(w)) return;
		var num = w.desktops[0].x11DesktopNumber,
			target = vis[num];
		if (!target) return; // its desktop is not visible
		if (w.output && w.output.name === target.name) return;
		workspace.sendClientToScreen(w, target);
		if (
			!w.desktops ||
			w.desktops.length !== 1 ||
			w.desktops[0].x11DesktopNumber !== num
		)
			log("WARN: moving '" + w.caption + "' changed its desktop assignment");
		if (CFG.logMoves)
			log("moved '" + w.caption + "' (desktop " + num + ") to " + target.name);
	}
	function migrateAll(vis) {
		var list = workspace.stackingOrder.slice
			? workspace.stackingOrder.slice()
			: workspace.stackingOrder;
		for (var i = 0; i < list.length; i++) place(list[i], vis);
	}

	// ---- event handlers (connected only while active) ----
	function onDesktopChanged(prev, cur, output) {
		if (!S.active || S.busy || !cur || !output || !S.offsets[output.name])
			return;
		dbg(
			"event " +
				output.name +
				": " +
				(prev ? prev.x11DesktopNumber : "?") +
				" -> " +
				cur.x11DesktopNumber,
		);
		run(function () {
			migrateAll(mapFromWant(syncFrom(output.name, cur.x11DesktopNumber)));
		});
	}
	function trackWindow(w) {
		if (!w || !w.desktopsChanged) return;
		hook(winConns, w, "desktopsChanged", function () {
			if (!S.active || S.busy) return;
			run(function () {
				place(w, liveMap());
			});
		});
	}
	function onWindowAdded(w) {
		if (!S.active) return;
		trackWindow(w);
		if (!S.busy)
			run(function () {
				place(w, liveMap());
			});
	}
	function onWindowRemoved(w) {
		for (var i = winConns.length - 1; i >= 0; i--)
			if (winConns[i].obj === w) {
				try {
					winConns[i].sig.disconnect(winConns[i].fn);
				} catch (e) {}
				winConns.splice(i, 1);
			}
	}

	// ---- lifecycle ----
	function stop() {
		unhookAll(syncConns);
		unhookAll(winConns);
		S.active = false;
	}
	function start() {
		stop();
		var cfg = build();
		S.errors = cfg.errors;
		if (cfg.errors.length) {
			log("DISABLED: " + cfg.errors.join("; "));
			return false;
		}
		S.offsets = offsetsFrom(cfg.coords, cfg.ref);
		S.W = cfg.W;
		S.H = cfg.H;
		S.mons = cfg.mons;
		S.ref = cfg.ref;
		S.active = true;
		hook(syncConns, workspace, "currentDesktopChanged", onDesktopChanged);
		hook(syncConns, workspace, "windowAdded", onWindowAdded);
		hook(syncConns, workspace, "windowRemoved", onWindowRemoved);
		var list = workspace.stackingOrder;
		for (var i = 0; i < list.length; i++) trackWindow(list[i]);
		run(function () {
			migrateAll(mapFromWant(syncFrom(S.ref, currentNum(outputByName(S.ref)))));
		});
		if (S.active)
			log(
				"ACTIVE: " +
					S.mons.length +
					" monitors, grid " +
					S.W +
					"x" +
					S.H +
					", anchor " +
					S.ref +
					", offsets " +
					JSON.stringify(S.offsets),
			);
		return S.active;
	}
	function wireOutputs() {
		unhookAll(outConns);
		var s = workspace.screens;
		for (var i = 0; i < s.length; i++)
			hook(outConns, s[i], "geometryChanged", reconfigure);
	}
	function reconfigure() {
		if (S.reconfiguring) return;
		S.reconfiguring = true;
		try {
			log("configuration changed, revalidating");
			wireOutputs();
			start();
		} catch (e) {
			log("ERROR during reconfigure: " + e);
			stop();
		} finally {
			S.reconfiguring = false;
		}
	}
	function shutdown() {
		stop();
		unhookAll(watchers);
		unhookAll(outConns);
	}
	function status() {
		log("active=" + S.active + " errors=[" + S.errors.join("; ") + "]");
		var s = workspace.screens;
		for (var i = 0; i < s.length; i++)
			log("  " + s[i].name + " -> desktop " + currentNum(s[i]));
	}

	hook(watchers, workspace, "screensChanged", reconfigure);
	hook(watchers, workspace, "desktopLayoutChanged", reconfigure);
	hook(watchers, workspace, "desktopsChanged", reconfigure);
	hook(watchers, workspace, "virtualScreenGeometryChanged", reconfigure);
	wireOutputs();
	start();

	return {
		start: start,
		stop: stop,
		reconfigure: reconfigure,
		shutdown: shutdown,
		status: status,
		state: S,
		config: CFG,
		_counts: function () {
			return {
				watchers: watchers.length,
				sync: syncConns.length,
				win: winConns.length,
				out: outConns.length,
			};
		},
	};
})();
