/* Small runtime shims for WebKit versions covered by our production target. */

if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value<T, U>(this: T[], callback: (value: T, index: number, array: T[]) => U | U[], thisArg?: unknown): U[] {
      return this.reduce<U[]>((result, value, index, array) => {
        return result.concat(callback.call(thisArg, value, index, array));
      }, []);
    },
  });
}

if (!Object.fromEntries) {
  Object.defineProperty(Object, 'fromEntries', {
    configurable: true,
    writable: true,
    value(entries: Iterable<readonly [PropertyKey, unknown]>) {
      const result: Record<PropertyKey, unknown> = {};
      for (const [key, value] of entries) result[key] = value;
      return result;
    },
  });
}

if (!window.queueMicrotask) {
  window.queueMicrotask = (callback: VoidFunction) => {
    Promise.resolve().then(callback).catch((error) => window.setTimeout(() => { throw error; }, 0));
  };
}

// Safari 12 does not implement Promise.allSettled. The application uses it
// while hydrating the initial screen, so feature-detect it before React boots.
if (!Promise.allSettled) {
  Promise.allSettled = function allSettled<T>(values: Iterable<T | PromiseLike<T>>) {
    return Promise.all(Array.from(values, (value) => Promise.resolve(value).then(
      (result) => ({ status: 'fulfilled' as const, value: result }),
      (reason) => ({ status: 'rejected' as const, reason }),
    )));
  };
}

// These are used by lazily rendered screens and arrived after Safari 12.
// Keeping the shims here prevents navigation from turning into a blank view.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value<T>(this: T[], index: number): T | undefined {
      const normalized = Math.trunc(index) || 0;
      return this[normalized < 0 ? this.length + normalized : normalized];
    },
  });
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true,
    writable: true,
    value(this: string, search: string | RegExp, replacement: string) {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll requires a global regular expression');
        return this.replace(search, replacement);
      }
      if (search === '') {
        return replacement + Array.from(this).join(replacement) + replacement;
      }
      return this.split(search).join(replacement);
    },
  });
}
