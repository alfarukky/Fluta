import { comingUpWording } from "@/server/domain/deliveries";
import type { ComingUp } from "@/types/deliveries";

// The bottom of the Deliveries view: the next 7 days, for planning only.
// Plain lines of text, with no customers, order numbers, links, or buttons.
export function ComingUpSection({ comingUp }: { comingUp: ComingUp }) {
  const { days, waiting, cleaning, empty } = comingUp;
  return (
    <section aria-labelledby="deliveries-coming-up" className="flex flex-col gap-component">
      <h2 id="deliveries-coming-up" className="type-h2 text-foreground">
        Coming up
      </h2>
      {empty ? (
        <p className="type-body-sm text-muted-foreground">{comingUpWording.empty}</p>
      ) : (
        <>
          {days.length > 0 && (
            <ul className="flex flex-col gap-component">
              {days.map((day) => (
                <li key={day.date} className="flex flex-col gap-1">
                  <h3 className="type-label text-foreground">{day.heading}</h3>
                  <ul className="flex flex-col gap-1">
                    {day.pickups.map((line, index) => (
                      <li key={index} className="type-body-sm wrap-break-word text-muted-foreground">
                        {line}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {waiting && <p className="type-body-sm text-muted-foreground">{waiting}</p>}
          {cleaning && <p className="type-body-sm text-muted-foreground">{cleaning}</p>}
        </>
      )}
    </section>
  );
}
