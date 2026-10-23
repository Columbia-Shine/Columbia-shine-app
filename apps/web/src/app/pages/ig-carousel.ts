import { Component, effect, ElementRef, input, viewChild } from '@angular/core';

declare global {
  interface Window {
    instgrm?: { Embeds: { process(): void } };
  }
}

let scriptLoading: Promise<void> | null = null;

/** Carga una sola vez el código oficial de Instagram para mostrar publicaciones. */
function loadInstagram(): Promise<void> {
  if (window.instgrm) return Promise.resolve();
  scriptLoading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://www.instagram.com/embed.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });
  return scriptLoading;
}

/** Carrusel de publicaciones de Instagram: se desliza con el dedo o con las flechas. */
@Component({
  selector: 'app-ig-carousel',
  template: `
    <div class="carrusel">
      <button class="flecha izq" type="button" aria-label="Anterior" (click)="move(-1)">‹</button>
      <div class="pista" #track>
        @for (p of posts(); track p) {
          <div class="item">
            <blockquote class="instagram-media" [attr.data-instgrm-permalink]="p" data-instgrm-version="14">
              <a [href]="p" target="_blank" rel="noopener">Ver la publicación en Instagram</a>
            </blockquote>
          </div>
        }
      </div>
      <button class="flecha der" type="button" aria-label="Siguiente" (click)="move(1)">›</button>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .carrusel { position: relative; }
    .pista { display: flex; gap: 16px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth; padding: 4px 4px 16px; scrollbar-width: thin; }
    .item { flex: 0 0 min(340px, 86vw); scroll-snap-align: start; }
    .item ::ng-deep .instagram-media { margin: 0 !important; min-width: 0 !important; width: 100% !important; border-radius: 14px !important; }
    .item ::ng-deep iframe { border-radius: 14px !important; }
    .flecha { position: absolute; top: 40%; z-index: 2; width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--gris-medio); background: rgba(17, 24, 39, 0.9); color: #fff; font-size: 30px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); }
    .flecha:hover { border-color: var(--amarillo); color: var(--amarillo); }
    .izq { left: -10px; }
    .der { right: -10px; }
    @media (max-width: 700px) { .flecha { display: none; } }
  `,
})
export class IgCarousel {
  posts = input<string[]>([]);
  private track = viewChild<ElementRef<HTMLElement>>('track');

  constructor() {
    // Cada vez que cambian las publicaciones, Instagram las vuelve a dibujar
    effect(() => {
      if (!this.posts().length) return;
      setTimeout(() => loadInstagram().then(() => window.instgrm?.Embeds.process()), 0);
    });
  }

  move(dir: number) {
    const el = this.track()?.nativeElement;
    if (el) el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 320), behavior: 'smooth' });
  }
}
