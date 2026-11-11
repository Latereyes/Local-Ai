package it.latereyes.localai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressTest {
    @Test
    fun soloIpDiventaHttpConPorta3000() {
        assertEquals("http://192.168.1.10:3000", Address.normalize(" 192.168.1.10 "))
    }

    @Test
    fun portaScrittaResta() {
        assertEquals("http://latereyes-pc:3100", Address.normalize("latereyes-pc:3100"))
    }

    @Test
    fun httpsSenzaPortaESenzaBarraFinale() {
        assertEquals("https://pc.tailnet.ts.net", Address.normalize("https://pc.tailnet.ts.net/"))
    }

    @Test
    fun indirizziNonValidi() {
        assertNull(Address.normalize(""))
        assertNull(Address.normalize("ftp://pc"))
        assertNull(Address.normalize("http://"))
    }

    @Test
    fun stessoPcAncheSuUnAltraPorta() {
        assertTrue(Address.sameHost("http://192.168.1.10:3000", "http://192.168.1.10:3001/abc/file.zip?download"))
        assertTrue(Address.sameHost("https://PC.tailnet.ts.net", "https://pc.tailnet.ts.net:8443/x"))
        assertFalse(Address.sameHost("http://192.168.1.10:3000", "https://github.com/"))
        assertFalse(Address.sameHost("http://192.168.1.10:3000", "mailto:a@b.it"))
    }
}
