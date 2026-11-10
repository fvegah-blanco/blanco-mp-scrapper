import { UA_NAVEGADOR } from '../common/http';

/**
 * Sesión HTTP mínima con cookies para las páginas WebForms de MP: la ficha
 * redirige (`?idlicitacion=` → `?qs=`) y la descarga de anexos exige la cookie
 * de sesión ASP.NET que se fijó al abrir la página de anexos.
 */
export class SesionWeb {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly timeoutMs = 60_000) {}

  async pedir(url: string, init: RequestInit = {}, saltos = 5): Promise<{ res: Response; url: string }> {
    let actual = url;
    let opciones = init;
    for (let i = 0; i <= saltos; i++) {
      const res = await fetch(actual, {
        ...opciones,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'User-Agent': UA_NAVEGADOR,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-CL,es;q=0.9',
          ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(opciones.headers as Record<string, string>),
        },
      });
      for (const c of res.headers.getSetCookie()) {
        const [par] = c.split(';');
        const igual = par.indexOf('=');
        if (igual > 0) this.cookies.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim());
      }
      const destino = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && destino) {
        await res.body?.cancel();
        actual = new URL(destino, actual).toString();
        // Tras un 302 de un POST se sigue con GET.
        opciones = { method: 'GET' };
        continue;
      }
      return { res, url: actual };
    }
    throw new Error(`Demasiadas redirecciones desde ${url}`);
  }

  async html(url: string): Promise<{ html: string; url: string }> {
    const { res, url: final } = await this.pedir(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${final}`);
    return { html: await res.text(), url: final };
  }
}
