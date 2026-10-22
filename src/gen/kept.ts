/**
 * A result made once per object and then kept for as long as that object lives: the plan of a habitat, the landmarks
 * and plantings of a terrain. Kept weakly, so a habitat or terrain given up takes its results with it. Pure.
 */
export function kept<K extends object, V>(make: (k: K) => V): (k: K) => V {
  const made = new WeakMap<K, V>();
  return (k) => {
    let v = made.get(k);
    if (v === undefined) { v = make(k); made.set(k, v); }
    return v;
  };
}

/**
 * A result per object and number, each made when first asked for and kept as long as the object lives: one court's
 * layout of a terrain's courts, one court's lift below.
 */
export function keptEach<K extends object, V>(make: (k: K, n: number) => V): (k: K, n: number) => V {
  const made = new WeakMap<K, Map<number, V>>();
  return (k, n) => {
    let all = made.get(k);
    if (!all) { all = new Map(); made.set(k, all); }
    if (!all.has(n)) all.set(n, make(k, n));
    return all.get(n)!;
  };
}
