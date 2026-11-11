package it.latereyes.localai

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.provider.MediaStore
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/**
 * LocalAI dentro un'app: la stessa interfaccia del browser (WebView) puntata al server del PC.
 * L'app aggiunge solo quello che la WebView non fa da sola: foto e file da allegare, microfono,
 * scaricamenti con la sessione già fatta, link esterni nel browser e la schermata «PC non raggiungibile».
 */
class MainActivity : ComponentActivity() {
    private val prefs by lazy { getSharedPreferences("localai", MODE_PRIVATE) }
    private var baseUrl: String
        get() = prefs.getString("url", "") ?: ""
        set(v) { prefs.edit().putString("url", v).apply() }

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorBox: LinearLayout
    private lateinit var errorText: TextView
    private var mainFrameFailed = false

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var pendingPermission: PermissionRequest? = null

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val photo = cameraUri
        cameraUri = null
        if (res.resultCode != RESULT_OK) return@registerForActivityResult cb.onReceiveValue(null)
        val data = res.data
        val uris = buildList {
            data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) add(clip.getItemAt(i).uri) }
            if (isEmpty()) data?.data?.let { add(it) }
            // la Fotocamera salva nel file che le abbiamo dato e spesso non rimanda nulla
            if (isEmpty() && photo != null) add(photo)
        }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val req = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        if (ok) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 15 disegna sempre sotto le barre di sistema: i margini li mettiamo noi (vedi sotto)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }

        val root = FrameLayout(this)
        web = WebView(this)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            visibility = View.GONE
        }
        errorBox = buildErrorBox()
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(errorBox, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP))
        setContentView(root)
        // Barre di sistema, ritaglio della fotocamera e tastiera: la pagina resta tutta visibile e il campo
        // di testo sale sopra la tastiera (adjustResize da solo non basta da Android 15)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }

        CookieManager.getInstance().setAcceptCookie(true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // preferenze di LocalAI in localStorage
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true) // target="_blank" passa da onCreateWindow
            javaScriptCanOpenWindowsAutomatically = true
            allowFileAccess = false
            userAgentString = "$userAgentString LocalAI-Android/${packageManager.getPackageInfo(packageName, 0).versionName}"
        }
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, userAgent, disposition, mime, _ -> download(url, userAgent, disposition, mime) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack()
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        cleanOldPhotos()
        when {
            baseUrl.isEmpty() || intent?.action == ACTION_ADDRESS -> askAddress()
            savedInstanceState != null && web.restoreState(savedInstanceState) != null -> Unit
            else -> loadHome()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_ADDRESS) askAddress()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        // la sessione (cookie) resta anche se Android chiude l'app
        CookieManager.getInstance().flush()
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private fun loadHome() {
        mainFrameFailed = false
        web.loadUrl("$baseUrl/")
    }

    private fun askAddress() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = "192.168.1.10:3000"
            setText(baseUrl)
            setSelection(text.length)
        }
        val box = FrameLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input)
        }
        val first = baseUrl.isEmpty()
        AlertDialog.Builder(this)
            .setTitle("Indirizzo di LocalAI")
            .setMessage(
                "Quello che apri nel browser del telefono.\n" +
                    "In casa: l'IP che LocalAI stampa all'avvio (porta 3000).\n" +
                    "Ovunque, con Tailscale: https://<nome-pc>.<tailnet>.ts.net (serve anche per il microfono)."
            )
            .setView(box)
            .setCancelable(!first)
            .setPositiveButton("Apri") { _, _ ->
                val url = Address.normalize(input.text.toString())
                if (url == null) {
                    Toast.makeText(this, "Indirizzo non valido", Toast.LENGTH_LONG).show()
                    askAddress()
                } else {
                    baseUrl = url
                    loadHome()
                }
            }
            .apply { if (!first) setNegativeButton("Annulla", null) }
            .show()
    }

    // ---- Schermata «PC non raggiungibile» -------------------------------------------------------

    private fun buildErrorBox(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
            visibility = View.GONE
            setBackgroundColor(ContextCompat.getColor(context, R.color.fondo))
        }
        errorText = TextView(this).apply {
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(context, R.color.testo))
        }
        box.addView(errorText)
        val retry = Button(this).apply {
            text = "Riprova"
            setOnClickListener { showWeb(); if (web.url.isNullOrEmpty() || web.url == "about:blank") loadHome() else { mainFrameFailed = false; web.reload() } }
        }
        val change = Button(this).apply {
            text = "Cambia indirizzo"
            setOnClickListener { askAddress() }
        }
        box.addView(retry, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })
        box.addView(change)
        return box
    }

    private fun showError(detail: CharSequence?) {
        errorText.text = "Non riesco a raggiungere LocalAI su\n$baseUrl\n\n" +
            "Il PC è acceso e LocalAI è avviato? Fuori casa serve Tailscale acceso sul telefono." +
            (if (detail.isNullOrBlank()) "" else "\n\n($detail)")
        errorBox.visibility = View.VISIBLE
        web.visibility = View.INVISIBLE
    }

    private fun showWeb() {
        errorBox.visibility = View.GONE
        web.visibility = View.VISIBLE
    }

    // ---- Navigazione ------------------------------------------------------------------------------

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (Address.sameHost(baseUrl, url)) return false
            openOutside(request.url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            mainFrameFailed = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            progress.visibility = View.GONE
            if (!mainFrameFailed) showWeb()
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            mainFrameFailed = true
            showError(error.description)
        }
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Nessuna app per aprire $uri", Toast.LENGTH_LONG).show()
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }

        /** «Apri» e i link in una scheda nuova: pagine e giochi della cartella di lavoro vanno nel browser del telefono. */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val probe = WebView(this@MainActivity)
            probe.webViewClient = object : WebViewClient() {
                private var done = false
                private fun take(uri: Uri): Boolean {
                    if (!done) {
                        done = true
                        openOutside(uri)
                        probe.post { probe.destroy() }
                    }
                    return true
                }
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest) = take(r.url)
                override fun onPageStarted(v: WebView, url: String?, favicon: Bitmap?) {
                    if (url != null && url != "about:blank") { v.stopLoading(); take(Uri.parse(url)) }
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = probe
            resultMsg.sendToTarget()
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE !in request.resources) return@runOnUiThread request.deny()
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingPermission?.deny()
                    pendingPermission = request
                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val accept = params.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
            val intent = when {
                params.isCaptureEnabled && accept.any { it.startsWith("image/") } -> cameraIntent()
                params.isCaptureEnabled && accept.any { it.startsWith("audio/") } -> Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION)
                else -> null
            }?.takeIf { it.resolveActivity(packageManager) != null } ?: pickerIntent(accept, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            return try {
                chooser.launch(intent)
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                cameraUri = null
                false
            }
        }
    }

    // ---- Foto, file e scaricamenti ----------------------------------------------------------------

    /** Tasto fotocamera di LocalAI (capture="environment"): scatto con l'app Fotocamera, salvato nella cache. */
    private fun cameraIntent(): Intent {
        val dir = File(cacheDir, "fotocamera").apply { mkdirs() }
        val file = File(dir, "foto-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        cameraUri = uri
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    /** Graffetta: immagini, PDF, testi e audio come nel campo accept di index.html. */
    private fun pickerIntent(accept: List<String>, multiple: Boolean): Intent {
        val mimes = accept.mapNotNull { type ->
            when {
                !type.startsWith(".") -> type
                type == ".md" -> "text/markdown"
                else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.drop(1))
            }
        }.distinct()
        return Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimes.singleOrNull() ?: "*/*"
            if (mimes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }
    }

    private fun cleanOldPhotos() {
        val limit = System.currentTimeMillis() - 24 * 3600_000L
        File(cacheDir, "fotocamera").listFiles()?.filter { it.lastModified() < limit }?.forEach { it.delete() }
    }

    /** «Scarica» di foto, video e file: va nella cartella Download con la sessione dell'app (cookie). */
    private fun download(url: String, userAgent: String?, disposition: String?, mime: String?) {
        if (!url.startsWith("http")) {
            Toast.makeText(this, "Questo file non si può scaricare dall'app", Toast.LENGTH_LONG).show()
            return
        }
        val name = URLUtil.guessFileName(url, disposition, mime)
        val req = DownloadManager.Request(Uri.parse(url)).apply {
            CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
            userAgent?.let { addRequestHeader("User-Agent", it) }
            if (!mime.isNullOrEmpty()) setMimeType(mime)
            setTitle(name)
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            // prima di Android 10 la cartella Download pubblica chiede un permesso in più: lì resta nella cartella dell'app
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            else setDestinationInExternalFilesDir(this@MainActivity, Environment.DIRECTORY_DOWNLOADS, name)
        }
        try {
            getSystemService(DownloadManager::class.java).enqueue(req)
            Toast.makeText(this, "Scarico $name", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Scaricamento non riuscito: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val ACTION_ADDRESS = "it.latereyes.localai.INDIRIZZO"
    }
}
