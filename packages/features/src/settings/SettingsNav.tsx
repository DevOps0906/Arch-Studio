// 설정 하위 목록(03장 8.3절: 일반 · 도면). 라이선스는 GNB 메뉴로만 두고 여기서 뺀다(D-32 a). 소유: AR-06-031.
import { cn } from "@arch-studio/ui";
import { Link, useLocation } from "react-router";

const ITEMS = [
  { to: "/settings/general", label: "일반" },
  { to: "/settings/drafting", label: "도면" },
] as const;

export function SettingsNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="설정" className="border-b border-line">
      <ul className="flex">
        {ITEMS.map((i) => {
          const active = pathname === i.to;
          return (
            <li key={i.to}>
              <Link
                to={i.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring -mb-px inline-flex h-control items-center border-b-2 px-3 text-body",
                  active ? "border-fg font-semibold text-fg" : "border-transparent text-fg-2 hover:text-fg",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
