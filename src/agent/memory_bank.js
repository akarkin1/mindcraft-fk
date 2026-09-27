export class MemoryBank {
	constructor() {
		this.memory = {};
		// Optional PlaceStore of the current world. Without it the places live in RAM only.
		this.store = null;
		this.getDimension = null;
	}

	get hasStore() {
		return this.store !== null;
	}

	/**
	 * From now on every read and write goes through the store. Places already
	 * in RAM are written to the store unless it has a place of that name.
	 * @param {PlaceStore} store a loaded PlaceStore
	 * @param {function(): string} [getDimension] returns the current dimension name
	 */
	attachStore(store, getDimension = null) {
		for (const [name, pos] of Object.entries(this.memory)) {
			if (store.recall(name) !== undefined)
				continue;
			try {
				store.remember(name, pos?.[0], pos?.[1], pos?.[2], null);
			} catch (err) {
				console.warn(`Could not move the place "${name}" into the place store: ${err?.message ?? err}`);
			}
		}
		// the RAM places now belong to this store and are not copied into a later one
		this.memory = {};
		this.store = store;
		this.getDimension = typeof getDimension === 'function' ? getDimension : null;
	}

	rememberPlace(name, x, y, z, dimension) {
		if (this.store === null) {
			this.memory[name] = [x, y, z];
			return;
		}
		if (dimension === undefined && this.getDimension !== null) {
			try {
				dimension = this.getDimension();
			} catch {
				dimension = null;
			}
		}
		// an invalid name must not end the process: log it and report false
		try {
			this.store.remember(name, x, y, z, dimension ?? null);
			return true;
		} catch (err) {
			console.warn(`Could not save the place "${name}": ${err?.message ?? err}`);
			return false;
		}
	}

	recallPlace(name) {
		if (this.store === null)
			return this.memory[name];
		const place = this.store.recall(name);
		return place === undefined ? undefined : [place.x, place.y, place.z];
	}

	recallPlaceInfo(name) {
		if (this.store === null) {
			const pos = Object.hasOwn(this.memory, name) ? this.memory[name] : undefined;
			if (!Array.isArray(pos))
				return undefined;
			return { x: pos[0], y: pos[1], z: pos[2], dimension: null };
		}
		const place = this.store.recall(name);
		if (place === undefined)
			return undefined;
		return { x: place.x, y: place.y, z: place.z, dimension: place.dimension ?? null };
	}

	forgetPlace(name) {
		if (this.store !== null)
			return this.store.forget(name);
		if (!Object.hasOwn(this.memory, name))
			return false;
		delete this.memory[name];
		return true;
	}

	getJson() {
		if (this.store !== null) {
			const json = {};
			for (const place of this.store.list())
				json[place.name] = [place.x, place.y, place.z];
			return json;
		}
		return this.memory
	}

	loadJson(json) {
		if (this.store !== null) {
			// replaces the places, as without a store
			for (const name of this.store.names())
				this.store.forget(name);
			for (const [name, pos] of Object.entries(json ?? {})) {
				try {
					this.store.remember(name, pos?.[0], pos?.[1], pos?.[2], null);
				} catch (err) {
					console.warn(`Could not load the place "${name}": ${err?.message ?? err}`);
				}
			}
			return;
		}
		this.memory = json;
	}

	getKeys() {
		if (this.store !== null)
			return this.store.names().join(', ');
		return Object.keys(this.memory).join(', ')
	}

	describePlaces() {
		let parts;
		if (this.store !== null)
			parts = this.store.list().map(place => place.dimension ? `${place.name} (${place.dimension})` : place.name);
		else
			parts = Object.keys(this.memory);
		return parts.length > 0 ? parts.join(', ') : 'none';
	}
}