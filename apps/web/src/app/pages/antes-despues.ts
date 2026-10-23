import { Component, Directive, ElementRef, inject, input, OnDestroy, signal } from '@angular/core';

/** Comparador de antes y después: se arrastra la línea (o se usa el deslizador) para ver los dos estados. */
@Component({
  selector: 'app-antes-despues',
  template: `
    <figure class="comparador">
      <div class="marco" [style.--corte.%]="pos()">
        <img class="despues" [src]="after()" [alt]="'Después: ' + (title() || 'moto lavada')" loading="lazy" />
        <img class="antes" [src]="before()" [alt]="'Antes: ' + (title() || 'moto sucia')" loading="lazy" />
        <span class="linea" aria-hidden="true"><span class="manija">‹ ›</span></span>
        <span class="marca izq">Antes</span>
        <span class="marca der">Después</span>
        <input type="range" min="0" max="100" [value]="pos()" (input)="pos.set(+$any($event.target).value)"
          [attr.aria-label]="'Comparar antes y después' + (title() ? ': ' + title() : '')" />
      </div>
      @if (title() || caption()) {
        <figcaption><strong>{{ title() }}</strong>@if (caption()) { <span> · {{ caption() }}</span> }</figcaption>
      }
    </figure>
  `,
  styles: `
    :host { display: block; }
    .comparador { margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .marco { position: relative; aspect-ratio: 4 / 3; border-radius: var(--radio); overflow: hidden; background: var(--gris-oscuro); user-select: none; }
    .marco img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .antes { clip-path: inset(0 calc(100% - var(--corte)) 0 0); }
    .linea { position: absolute; top: 0; bottom: 0; left: var(--corte); width: 3px; background: #fff; transform: translateX(-50%); pointer-events: none; box-shadow: 0 0 12px rgba(0, 0, 0, 0.5); }
    .manija { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; border-radius: 50%; background: var(--amarillo); color: var(--negro); font-weight: 800; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .marca { position: absolute; top: 12px; padding: 4px 10px; border-radius: 999px; background: rgba(11, 15, 23, 0.75); font-size: 12px; font-weight: 700; pointer-events: none; }
    .marca.izq { left: 12px; }
    .marca.der { right: 12px; }
    input[type='range'] { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
    figcaption { color: var(--texto-suave); }
    figcaption strong { color: #fff; }
  `,
})
export class AntesDespues {
  before = input.required<string>();
  after = input.required<string>();
  title = input<string | null>(null);
  caption = input<string | null>(null);
  protected pos = signal(50);
}

/** Hace aparecer suavemente un bloque cuando entra en pantalla (sin animación si la persona la desactivó). */
@Directive({ selector: '[aparecer]', host: { class: 'aparecer' } })
export class Aparecer implements OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
              this.el.classList.add('visible');
              this.observer?.disconnect();
            }
          },
          { rootMargin: '0px 0px -10% 0px' },
        );

  constructor() {
    if (this.observer) this.observer.observe(this.el);
    else this.el.classList.add('visible');
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
