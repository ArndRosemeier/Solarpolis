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
