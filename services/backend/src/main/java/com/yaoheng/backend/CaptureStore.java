package com.yaoheng.backend;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import javax.imageio.ImageIO;
import static com.yaoheng.backend.R1Service.*;

/** Only server-generated patient/hash paths; no user filename becomes a path. */
final class CaptureStore {
    static final int MAX_BYTES = 5 * 1024 * 1024;
    final Path root = Path.of(System.getenv().getOrDefault(
        "CAPTURE_STORAGE_ROOT", ".local-evidence/captures/"+System.getenv().getOrDefault("DB_NAME","default"))).toAbsolutePath().normalize();
    static byte[] bounded(InputStream in, int maximum) throws IOException {
        byte[] bytes = in.readNBytes(maximum + 1);
        if (bytes.length > maximum) throw new Failure(413, "CAPTURE_TOO_LARGE");
        return bytes;
    }
    static String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    static void validate(byte[] bytes, String name, String mime) {
        if (name == null || name.length() > 180 || name.contains("/") || name.contains("\\") || name.chars().anyMatch(ch->ch<32) || name.contains(".."))
            throw new Failure(422, "INVALID_CAPTURE_FILENAME");
        String lower = name.toLowerCase(Locale.ROOT);
        boolean png = "image/png".equals(mime) && lower.endsWith(".png");
        boolean jpeg = "image/jpeg".equals(mime) && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"));
        if (!png && !jpeg) throw new Failure(415, "CAPTURE_TYPE_NOT_ALLOWED");
        if (bytes.length < 8 || bytes.length > MAX_BYTES) throw new Failure(422, "INVALID_CAPTURE_IMAGE");
        byte[] signature = {(byte)137,80,78,71,13,10,26,10};
        if (png && !Arrays.equals(Arrays.copyOf(bytes,8),signature) ||
            jpeg && (bytes[0] != (byte)255 || bytes[1] != (byte)216 || bytes[2] != (byte)255))
            throw new Failure(415, "CAPTURE_SIGNATURE_MISMATCH");
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw new IOException();
            var reader = readers.next();
            try {
                reader.setInput(stream);
                int w=reader.getWidth(0), h=reader.getHeight(0);
                if (w<1 || h<1 || (long)w*h>16000000L || w>10000 || h>10000)
                    throw new Failure(422, "CAPTURE_DIMENSIONS_EXCEEDED");
                if (reader.read(0)==null) throw new IOException();
            } finally { reader.dispose(); }
        } catch (Failure e) { throw e; }
        catch (IOException | RuntimeException e) { throw new Failure(422, "INVALID_CAPTURE_IMAGE"); }
    }
    Path path(int patient, String hash) {
        if (patient<=0 || !hash.matches("[a-f0-9]{64}")) throw new Failure(422, "INVALID_CAPTURE_PATH");
        return root.resolve(Integer.toString(patient)).resolve(hash+".bin");
    }
    private void safe(Path path) throws IOException {
        for (Path p=path; p!=null; p=p.getParent())
            if (Files.isSymbolicLink(p)) throw new IOException("SYMLINK_NOT_ALLOWED");
    }
    void put(int patient, String hash, byte[] bytes) {
        Path target=path(patient,hash), temp=null;
        try {
            safe(target); Files.createDirectories(target.getParent());
            if (Files.exists(target)) {
                if (!digest(Files.readAllBytes(target)).equals(hash)) throw new IOException();
                return;
            }
            temp=Files.createTempFile(target.getParent(),"upload-",".tmp");
            Files.write(temp,bytes);
            try { Files.move(temp,target,StandardCopyOption.ATOMIC_MOVE); }
            catch (FileAlreadyExistsException e) { /* identical content-addressed concurrent upload */ }
        } catch (IOException e) { throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE"); }
        finally { if(temp!=null)try{Files.deleteIfExists(temp);}catch(IOException ignored){} }
    }
    byte[] get(int patient, String hash) {
        try {
            Path p=path(patient,hash);safe(p);
            try(var in=Files.newInputStream(p)){byte[] bytes=bounded(in,MAX_BYTES);
                if(!digest(bytes).equals(hash))throw new Failure(409,"CAPTURE_HASH_MISMATCH");return bytes;}
        } catch (IOException e) { throw new Failure(410,"CAPTURE_FILE_UNAVAILABLE"); }
    }
    void delete(int patient,String hash) {
        try {Path p=path(patient,hash);safe(p);Files.deleteIfExists(p);}
        catch(IOException e){throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE");}
    }
}
