import { returnTarget } from "../navigation/return-target";
import { useNavigate, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
export function CategoryAnalysisPicker({
  month,
  category = "",
}: {
  month: string;
  category?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const origin = category
    ? location.state
    : { returnTo: location.pathname + location.search + location.hash };
  const back = returnTarget(origin?.returnTo, "/analysis");
  const allCategories = /^\/analysis(?:[?#]|$)/.test(back.to)
    ? back.to
    : "/analysis";
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.archived && !c.parentId).toArray(),
    [],
  );
  return (
    <label className="analysis-category-picker">
      Category analysis
      <select
        aria-label="Category analysis"
        value={category}
        onChange={(e) =>
          navigate(
            e.target.value
              ? `/categories/${e.target.value}?month=${month}`
              : allCategories,
            { state: e.target.value ? origin : undefined },
          )
        }
      >
        <option value="">All categories</option>
        {categories?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
