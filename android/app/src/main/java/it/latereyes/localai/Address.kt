package it.latereyes.localai

import java.net.URI

/** Indirizzo di LocalAI scritto a mano sul telefono. Senza Android, così si prova con i test JVM. */
object Address {
    /** Porta di LocalAI in HTTP (config.js, PORT). In HTTPS con Tailscale è la 443, che non si scrive. */
    const val DEFAULT_PORT = 3000

    /**
     * "192.168.1.10" → "http://192.168.1.10:3000"; "https://pc.tailnet.ts.net/" → "https://pc.tailnet.ts.net".
     * null se non è un indirizzo http(s) valido.
     */
    fun normalize(input: String): String? {
        var text = input.trim()
        if (text.isEmpty()) return null
        if (!text.contains("://")) text = "http://$text"
        val uri = try { URI(text) } catch (_: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        val port = when {
            uri.port != -1 -> uri.port
            scheme == "http" -> DEFAULT_PORT
            else -> -1
        }
        val path = (uri.rawPath ?: "").trimEnd('/')
        return buildString {
            append(scheme).append("://").append(host)
            if (port != -1) append(':').append(port)
            append(path)
        }
    }

    /**
     * Stesso PC dell'app (qualunque porta): resta dentro l'app. Così anche i file della cartella di lavoro
     * (porta 3001, «Scarica») passano dallo scaricamento dell'app e non aprono il browser.
     */
    fun sameHost(base: String, url: String): Boolean = try {
        val a = URI(base).host
        val b = URI(url).host
        a != null && b != null && a.equals(b, ignoreCase = true)
    } catch (_: Exception) {
        false
    }
}
