import http from '@/axios/index.js';

export function loginUserInfo(token) {
    return http.get('/my/loginUserInfo',token ? {headers:{Authorization:token}} : {})
}

export function resetPassword(password) {
    return http.put('/my/resetPassword', {password})
}

export function userDelete() {
    return http.delete('/my/delete')
}

