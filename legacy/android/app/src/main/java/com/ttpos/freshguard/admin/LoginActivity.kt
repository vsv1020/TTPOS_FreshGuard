package com.ttpos.freshguard.admin

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

class LoginActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val apiClient = ApiClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        val emailInput = findViewById<EditText>(R.id.emailInput)
        val passwordInput = findViewById<EditText>(R.id.passwordInput)
        val errorLabel = findViewById<TextView>(R.id.errorLabel)
        val loginButton = findViewById<Button>(R.id.loginButton)

        loginButton.setOnClickListener {
            errorLabel.text = ""
            val email = emailInput.text.toString().trim()
            val password = passwordInput.text.toString()

            if (email.isBlank() || password.isBlank()) {
                errorLabel.text = "Email and password are required"
                return@setOnClickListener
            }

            loginButton.isEnabled = false
            executor.execute {
                try {
                    val response = apiClient.login(email, password)
                    getSharedPreferences("auth", MODE_PRIVATE)
                        .edit()
                        .putString("jwt", response.token)
                        .putString("email", response.user.email)
                        .apply()

                    runOnUiThread {
                        startActivity(Intent(this, DashboardActivity::class.java))
                        finish()
                    }
                } catch (error: Exception) {
                    runOnUiThread {
                        loginButton.isEnabled = true
                        errorLabel.text = error.message ?: "Login failed"
                    }
                }
            }
        }
    }
}
