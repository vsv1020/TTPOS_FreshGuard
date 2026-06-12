package com.ttpos.freshguard.admin

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

private const val DEFAULT_BASE_URL = "http://10.0.2.2:4000"

data class LoginUser(val id: Long, val email: String, val role: String)

data class LoginResponse(val token: String, val user: LoginUser)

class ApiClient(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val client: OkHttpClient = OkHttpClient.Builder().build()
) {
    @Throws(IOException::class)
    fun login(email: String, password: String): LoginResponse {
        val requestJson = JSONObject()
            .put("email", email)
            .put("password", password)
            .toString()
        val request = Request.Builder()
            .url("$baseUrl/api/auth/login")
            .post(requestJson.toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Login failed with HTTP ${response.code}")
            }

            val body = response.body?.string() ?: throw IOException("Empty login response")
            val root = JSONObject(body)
            val userObj = root.getJSONObject("user")
            return LoginResponse(
                token = root.getString("token"),
                user = LoginUser(
                    id = userObj.getLong("id"),
                    email = userObj.getString("email"),
                    role = userObj.getString("role")
                )
            )
        }
    }
}
